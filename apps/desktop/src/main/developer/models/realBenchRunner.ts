import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BENCH_LIMITS,
  BENCH_SYSTEM,
  CodeModelFormatError,
  EDIT_FIXTURE_FILES,
  EDIT_FIXTURE_PATH,
  JARVIS_PROJECT_PROFILE,
  REAL_BENCH_TASKS,
  REVIEW_RULES,
  addUsage,
  judgeAsk,
  judgeReview,
  limitText,
  parseNvidiaSmi,
  parsePlanReply,
  planPrompt,
  planSystemPrompt,
  scanLine,
  scoreRoles,
  singleHunkDiff,
  tokensPerSecond,
  toolView,
  withDeadline,
  type ChatUsage,
  type CodeAIProvider,
  type RealBenchResult,
  type RealBenchTask,
  type RealBenchTaskResult,
  type StepLimit,
  type ToolManager,
} from '@jarvis/core';
import { runAsk, repoReader } from '../ask/askFlow.js';
import type { Runner } from '../runner.js';
import { createBenchTools } from './benchTools.js';
import type { TscLocation } from './benchRunner.js';
import { readGpuMemory } from './hardwareProbe.js';
import type { OllamaApi } from './ollamaApi.js';

export interface RealBenchDeps {
  provider: CodeAIProvider;
  /** Outils de lecture de la copie de travail, inscrits au journal. */
  readTools: Pick<ToolManager, 'schemas' | 'execute'>;
  repoRoot: string;
  commit: string | null;
  run: Runner;
  ollama: OllamaApi;
  /** null : modification et correction non vérifiables. */
  tsc: TscLocation | null;
  nodePath: string | null;
  /** Dossier jetable des tâches de modification, jamais la copie de travail. */
  workDir: string;
  signal?: AbortSignal;
  /** Avant chaque tour du modèle : la discussion garde la priorité. */
  pause?: () => Promise<void>;
  onTask?: (task: RealBenchTask, status: 'running' | 'done' | 'failed', detail?: string) => void;
  now?: () => number;
}

interface Outcome {
  ok: boolean | null;
  detail: string;
  usage?: ChatUsage;
  calls?: number;
}

const unmeasurable = (detail: string): Outcome => ({
  ok: null,
  detail: `non mesurable : ${detail}`,
});

async function compileAndCheck(
  deps: RealBenchDeps,
  dir: string,
): Promise<{ ok: boolean; output: string } | null> {
  if (!deps.tsc || !deps.nodePath) return null;
  const compiled = await deps.run({
    program: deps.tsc.nodePath,
    args: [deps.tsc.tscPath, '-p', join(dir, 'tsconfig.json')],
    cwd: dir,
    timeoutMs: 120_000,
    display: 'npx tsc -p tsconfig.json',
    signal: deps.signal,
  });
  if (compiled.code !== 0 || compiled.error)
    return { ok: false, output: `${compiled.stdout}${compiled.stderr}`.trim().slice(0, 3_000) };
  const checked = await deps.run({
    program: deps.nodePath,
    args: ['check.mjs'],
    cwd: dir,
    timeoutMs: 30_000,
    display: 'node check.mjs',
    signal: deps.signal,
  });
  return {
    ok: checked.code === 0 && !checked.error,
    output: `${checked.stdout}${checked.stderr}`.trim().slice(0, 3_000),
  };
}

async function runTask(
  deps: RealBenchDeps,
  task: RealBenchTask,
  read: (path: string) => Promise<string | null>,
  limit: StepLimit,
): Promise<Outcome> {
  const truth = 'truth' in task ? task.truth : null;
  if (truth) {
    const text = await read(truth.path);
    if (text === null) return unmeasurable(`${truth.path} absent de la copie`);
    if (!text.includes(truth.contains))
      return unmeasurable(`${truth.path} ne contient plus « ${truth.contains} »`);
  }
  switch (task.kind) {
    case 'ask': {
      const result = await runAsk(
        {
          code: deps.provider,
          tools: deps.readTools,
          read,
          profile: JARVIS_PROJECT_PROFILE,
          signal: deps.signal,
          limit,
          beforeRound: deps.pause,
          maxRounds: 8,
        },
        task.question,
      );
      return { ...judgeAsk(task, result.checked), usage: result.usage, calls: result.calls };
    }
    case 'plan': {
      const loop = await deps.provider.runTools({
        tools: toolView(deps.readTools, ['dev_read_file', 'dev_search_code', 'dev_search_files']),
        system: planSystemPrompt(),
        prompt: planPrompt(task.request),
        maxRounds: 10,
        maxTokens: limit.maxTokens,
        signal: deps.signal,
        beforeRound: deps.pause,
      });
      if (loop.stoppedBy === 'error') return { ok: false, detail: `erreur : ${loop.error}` };
      try {
        const plan = parsePlanReply(loop.finalText);
        const files = plan.files.map((f) => f.path);
        const ok = task.expectFiles.some((f) => files.includes(f));
        return {
          ok,
          detail: ok
            ? `plan valide, ${files.length} fichier(s)`
            : `fichier attendu absent du plan (${task.expectFiles[0]})`,
          usage: loop.usage,
          calls: loop.calls.length,
        };
      } catch (error) {
        if (error instanceof CodeModelFormatError)
          return {
            ok: false,
            detail: 'plan hors format',
            usage: loop.usage,
            calls: loop.calls.length,
          };
        throw error;
      }
    }
    case 'review': {
      const before = await read(task.source);
      if (before === null) return unmeasurable(`${task.source} absent de la copie`);
      const after = task.mutate(before);
      if (after === null) return unmeasurable(`motif attendu absent de ${task.source}`);
      await deps.pause?.();
      try {
        const report = await deps.provider.reviewCode({
          diff: singleHunkDiff(task.source, before, after),
          rules: REVIEW_RULES,
          maxTokens: limit.maxTokens,
          ...(deps.signal ? { signal: deps.signal } : {}),
        });
        return judgeReview(task, report);
      } catch (error) {
        if (error instanceof CodeModelFormatError)
          return { ok: false, detail: 'revue hors format' };
        throw error;
      }
    }
    case 'edit': {
      const original = await read(task.source);
      if (original === null) return unmeasurable(`${task.source} absent de la copie`);
      const start = task.mutate ? task.mutate(original) : original;
      if (start === null) return unmeasurable(`motif attendu absent de ${task.source}`);
      if (!deps.tsc || !deps.nodePath)
        return unmeasurable('tsc ou node indisponible (installe les dépendances de la copie)');
      const dir = join(deps.workDir, task.id);
      await rm(dir, { recursive: true, force: true });
      const files = { ...EDIT_FIXTURE_FILES, [EDIT_FIXTURE_PATH]: start, 'check.mjs': task.check };
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), content);
      }
      const before = task.mutate ? await compileAndCheck(deps, dir) : null;
      const loop = await deps.provider.runTools({
        system: BENCH_SYSTEM,
        prompt: task.prompt(before?.output || '(sortie indisponible)'),
        tools: createBenchTools(dir),
        maxRounds: 8,
        maxTokens: limit.maxTokens,
        signal: deps.signal,
        beforeRound: deps.pause,
      });
      const base = { usage: loop.usage, calls: loop.calls.length };
      if (loop.stoppedBy === 'error')
        return { ...base, ok: false, detail: `erreur : ${loop.error}` };
      const edited = await readFile(join(dir, EDIT_FIXTURE_PATH), 'utf8');
      if (/@ts-(ignore|nocheck|expect-error)/.test(edited))
        return { ...base, ok: false, detail: 'vérification désactivée (@ts-…)' };
      // Seules les lignes écrites par le modèle comptent : le vrai fichier contient déjà une URL.
      const existing = new Set(start.split('\n'));
      const sensitive = edited
        .split('\n')
        .flatMap((line, index) =>
          existing.has(line) ? [] : scanLine(EDIT_FIXTURE_PATH, index + 1, line),
        );
      if (sensitive.length)
        return { ...base, ok: false, detail: 'code sensible ajouté : non exécuté' };
      const after = await compileAndCheck(deps, dir);
      if (!after) return { ...base, ...unmeasurable('tsc ou node indisponible') };
      return {
        ...base,
        ok: after.ok,
        detail: after.ok
          ? 'compilé, contrôle réussi'
          : `contrôle en échec : ${after.output.split('\n')[0]}`,
      };
    }
    case 'complete': {
      const texts: Record<string, string> = {};
      for (const path of task.sources) {
        const text = await read(path);
        if (text === null) return unmeasurable(`${path} absent de la copie`);
        texts[path] = text;
      }
      const prompt = task.prompt(texts);
      if (prompt === null) return unmeasurable('extrait attendu absent');
      await deps.pause?.();
      const { text, usage } = await deps.provider.complete({
        system: 'Tu es un assistant de développement. Réponds en français, sans détour.',
        prompt,
        maxTokens: limit.maxTokens,
        signal: deps.signal,
      });
      const ok = task.accept(text);
      return {
        ok,
        detail: ok ? 'réponse acceptée' : `réponse refusée : ${text.trim().slice(0, 120)}`,
        usage,
      };
    }
  }
}

/** Banc réel : tâches tirées de la copie de travail ; ne choisit aucun modèle. */
export async function runRealBenchmark(deps: RealBenchDeps): Promise<RealBenchResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const read = repoReader(deps.repoRoot);
  const tasks: RealBenchTaskResult[] = [];
  let usage: ChatUsage = {
    promptTokens: 0,
    promptMs: 0,
    outputTokens: 0,
    outputMs: 0,
    loadMs: 0,
    totalMs: 0,
  };
  let firstLoadMs: number | null = null;
  for (const task of REAL_BENCH_TASKS) {
    if (deps.signal?.aborted) break;
    deps.onTask?.(task, 'running');
    const started = now();
    const limit = BENCH_LIMITS[task.kind];
    const deadline = withDeadline(deps.signal, limit.timeoutMs);
    const late = (usage?: ChatUsage): Outcome => ({
      ok: false,
      detail: `délai dépassé (${limitText(limit)})`,
      ...(usage ? { usage } : {}),
    });
    let outcome: Outcome;
    try {
      outcome = await runTask({ ...deps, signal: deadline.signal }, task, read, limit);
      if (deadline.expired() && outcome.ok !== true) outcome = late(outcome.usage);
    } catch (error) {
      if (deps.signal?.aborted) throw error;
      outcome = deadline.expired()
        ? late()
        : {
            ok: false,
            detail: `erreur : ${error instanceof Error ? error.message : String(error)}`,
          };
    } finally {
      deadline.dispose();
    }
    if (outcome.usage) {
      usage = addUsage(usage, outcome.usage);
      if (firstLoadMs === null && outcome.usage.loadMs > 0) firstLoadMs = outcome.usage.loadMs;
    }
    tasks.push({
      id: task.id,
      label: task.label,
      roles: [...task.roles],
      ok: outcome.ok,
      detail: outcome.detail,
      durationMs: now() - started,
      outputTokPerSec:
        outcome.usage && outcome.usage.outputMs > 0
          ? Math.round(tokensPerSecond(outcome.usage.outputTokens, outcome.usage.outputMs) * 10) /
            10
          : null,
      calls: outcome.calls ?? 0,
    });
    deps.onTask?.(task, outcome.ok === false ? 'failed' : 'done', outcome.detail);
  }
  const loaded = (await deps.ollama.running()).find((m) => m.name === deps.provider.model);
  const gpu = await readGpuMemory(deps.run, deps.workDir);
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    model: deps.provider.model,
    startedAt,
    finishedAt: now(),
    commit: deps.commit,
    tasks,
    roles: scoreRoles(tasks),
    metrics: {
      outputTokPerSec:
        usage.outputMs > 0 ? round(tokensPerSecond(usage.outputTokens, usage.outputMs)) : null,
      promptTokPerSec:
        usage.promptMs > 0 ? round(tokensPerSecond(usage.promptTokens, usage.promptMs)) : null,
      loadMs: firstLoadMs,
      sizeBytes: loaded?.sizeBytes ?? null,
      sizeVramBytes: loaded?.sizeVramBytes ?? null,
      gpuUsedMiB: gpu.probe === 'ok' ? (parseNvidiaSmi(gpu.output)[0]?.usedMiB ?? null) : null,
      ramUsedBytes: loaded ? Math.max(0, loaded.sizeBytes - loaded.sizeVramBytes) : null,
    },
  };
}
