import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BENCH_BROKEN_READFILE,
  BENCH_FIXTURE,
  BENCH_SYSTEM,
  BENCH_TASKS,
  addUsage,
  checkEdit,
  parseNvidiaSmi,
  scoreToolCall,
  summarizeBench,
  tokensPerSecond,
  type BenchResult,
  type BenchTask,
  type BenchTaskResult,
  type ChatUsage,
  type CodeAIProvider,
} from '@jarvis/core';
import type { Runner } from '../runner.js';
import { createBenchTools } from './benchTools.js';
import { readGpuMemory } from './hardwareProbe.js';
import type { OllamaApi } from './ollamaApi.js';

export interface TscLocation {
  nodePath: string;
  tscPath: string;
}

export interface BenchDeps {
  provider: CodeAIProvider;
  expertsInRam: boolean;
  ollama: OllamaApi;
  run: Runner;
  workDir: string;
  /** null : pas de TypeScript dans la copie de travail, modification et correction non vérifiables. */
  tsc: TscLocation | null;
  signal?: AbortSignal;
  onTask?: (task: BenchTask, status: 'running' | 'done' | 'failed', detail?: string) => void;
  now?: () => number;
}

const TSC_DISPLAY = 'npx tsc --noEmit -p tsconfig.json';
const CANNED_TSC_ERROR =
  "src/tools/readFile.ts(8,51): error TS2304: Cannot find name 'DEFAULT_MAX_CHARS'.";

async function writeProject(dir: string, overrides: Record<string, string>): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  for (const [path, content] of Object.entries({ ...BENCH_FIXTURE, ...overrides })) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

async function compile(
  deps: BenchDeps,
  dir: string,
): Promise<{ ok: boolean; output: string } | null> {
  if (!deps.tsc) return null;
  const outcome = await deps.run({
    program: deps.tsc.nodePath,
    args: [deps.tsc.tscPath, '-p', join(dir, 'tsconfig.json')],
    cwd: dir,
    timeoutMs: 120_000,
    display: TSC_DISPLAY,
    signal: deps.signal,
  });
  return {
    ok: outcome.code === 0 && !outcome.error,
    output: `${outcome.stdout}${outcome.stderr}`.trim().slice(0, 4_000),
  };
}

/** Banc de code sur un modèle déjà installé : dossiers jetables, réussites vérifiées par tsc. */
export async function runCodeBenchmark(deps: BenchDeps): Promise<BenchResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const tasks: BenchTaskResult[] = [];
  let usage: ChatUsage = {
    promptTokens: 0,
    promptMs: 0,
    outputTokens: 0,
    outputMs: 0,
    loadMs: 0,
    totalMs: 0,
  };
  let firstLoadMs: number | null = null;
  for (const task of BENCH_TASKS) {
    if (deps.signal?.aborted) break;
    deps.onTask?.(task, 'running');
    const dir = join(deps.workDir, task.id);
    await writeProject(
      dir,
      task.kind === 'fix' ? { 'src/tools/readFile.ts': BENCH_BROKEN_READFILE } : {},
    );
    const before = task.kind === 'fix' ? await compile(deps, dir) : null;
    const started = now();
    const result = await deps.provider.runTools({
      system: BENCH_SYSTEM,
      prompt: task.prompt({ tscOutput: before?.output || CANNED_TSC_ERROR }),
      tools: createBenchTools(dir),
      maxRounds: task.maxRounds,
      signal: deps.signal,
    });
    if (firstLoadMs === null && result.usage.loadMs > 0) firstLoadMs = result.usage.loadMs;
    usage = addUsage(usage, result.usage);
    let ok: boolean | null;
    let detail: string;
    if (task.kind === 'tool-call') {
      ({ ok, detail } = scoreToolCall(task.id, result));
    } else {
      const text = await readFile(
        join(dir, task.kind === 'edit' ? 'src/tools/index.ts' : 'src/tools/readFile.ts'),
        'utf8',
      );
      const compiled = await compile(deps, dir);
      const textCheck =
        task.kind === 'edit'
          ? checkEdit(text)
          : /@ts-(ignore|nocheck|expect-error)/.test(text)
            ? { ok: false, detail: 'la vérification a été désactivée (@ts-…)' }
            : { ok: true, detail: 'texte correct' };
      if (result.error) [ok, detail] = [false, `Erreur : ${result.error}`];
      else if (!textCheck.ok) [ok, detail] = [false, textCheck.detail];
      else if (!compiled)
        [ok, detail] = [
          null,
          `${textCheck.detail} ; compilation non vérifiable (installe les dépendances de la copie de travail)`,
        ];
      else
        [ok, detail] = compiled.ok
          ? [true, `${textCheck.detail}, tsc sans erreur`]
          : [false, `tsc échoue : ${compiled.output.split('\n')[0]}`];
    }
    tasks.push({
      id: task.id,
      label: task.label,
      kind: task.kind,
      ok,
      detail,
      durationMs: now() - started,
      outputTokPerSec:
        result.usage.outputMs > 0
          ? Math.round(tokensPerSecond(result.usage.outputTokens, result.usage.outputMs) * 10) / 10
          : null,
      calls: result.calls.length,
    });
    deps.onTask?.(task, ok === false ? 'failed' : 'done', detail);
  }
  const loaded = (await deps.ollama.running()).find((model) => model.name === deps.provider.model);
  const gpu = await readGpuMemory(deps.run, deps.workDir);
  const gpuUsed = gpu.probe === 'ok' ? (parseNvidiaSmi(gpu.output)[0]?.usedMiB ?? null) : null;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    model: deps.provider.model,
    expertsInRam: deps.expertsInRam,
    startedAt,
    finishedAt: now(),
    tasks,
    metrics: {
      outputTokPerSec:
        usage.outputMs > 0 ? round(tokensPerSecond(usage.outputTokens, usage.outputMs)) : null,
      promptTokPerSec:
        usage.promptMs > 0 ? round(tokensPerSecond(usage.promptTokens, usage.promptMs)) : null,
      loadMs: firstLoadMs,
      sizeBytes: loaded?.sizeBytes ?? null,
      sizeVramBytes: loaded?.sizeVramBytes ?? null,
      gpuUsedMiB: gpuUsed,
      ramUsedBytes: loaded ? Math.max(0, loaded.sizeBytes - loaded.sizeVramBytes) : null,
    },
    summary: summarizeBench(tasks),
  };
}
