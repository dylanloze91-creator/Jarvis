/**
 * Exécution du laboratoire. Ce fichier n’est pas exporté par l’index :
 * la fenêtre ne doit pas embarquer node:fs. Le modèle est injecté ;
 * ollamaLabModel parle au fournisseur déjà sur la machine.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMission, type MissionState } from './engine/mission.js';
import { judgeMissionEvidence, missionVerdictFromEvidence, type MissionEvidence } from './evidence.js';
import { selectSkill } from '../learning/skills.js';
import type { LearningRecord } from '../learning/continuous.js';
import { OllamaProvider } from '../providers/ollama.js';
import type { ChatMessage, ToolCall } from '../types.js';
import {
  LAB_LIMITS,
  LAB_MODEL_DIGEST_PREFIX,
  LAB_MODEL_NAME,
  classifyLabRow,
  labBrief,
  labContamination,
  levelSound,
  missionsForLevel,
  skillBrief,
  validateLabMission,
  type LabBrief,
  type LabFile,
  type LabLevel,
  type LabMission,
  type LabRowStatus,
} from './lab.js';

export interface LabModel {
  name: string;
  digest: string;
  complete(input: {
    system: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
  }): Promise<{ text: string; toolCalls: ToolCall[] }>;
}

export interface LabAttempt {
  exitCode: number | null;
  testsRan: number | null;
  failed: number | null;
  summary: string;
  shownToModel: string;
  regressionFailed?: boolean;
}

export interface LabRunResult {
  missionId: string;
  arm: 'alone' | 'skill';
  synthetic: boolean;
  excluded: boolean;
  excludeReason: string | null;
  attempts: LabAttempt[];
  modelCalls: number;
  prompt: string;
  promptHasHidden: boolean;
  files: LabFile[];
  evidence: MissionEvidence | null;
  status: LabRowStatus;
  reason: string;
  declaredSuccess: boolean;
}

const TOOLS = [
  {
    name: 'list_files',
    description: 'Liste les fichiers du dossier de travail.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Lit un fichier du dossier de travail.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: 'Écrit un fichier du dossier de travail. Pas de test, pas de chemin hors dossier.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
];

function countNodeTests(output: string): { total: number | null; failed: number | null } {
  const total = /(?:ℹ|#)\s+tests\s+(\d+)/.exec(output);
  const failed = /(?:ℹ|#)\s+fail\s+(\d+)/.exec(output);
  const pass = /(?:ℹ|#)\s+pass\s+(\d+)/.exec(output);
  if (total) return { total: Number(total[1]), failed: failed ? Number(failed[1]) : 0 };
  if (pass && failed) return { total: Number(pass[1]) + Number(failed[1]), failed: Number(failed[1]) };
  return { total: null, failed: null };
}

export function sanitizeTestFeedback(output: string): string {
  const kept = output
    .split(/\r?\n/)
    .filter((line) => {
      const text = line.trim();
      if (!text) return false;
      if (/assert\.|node:test|hidden\/|\.test\.mjs|import /.test(text)) return false;
      return /fail|Error|expected|Expected|actual|Assertion/.test(text);
    })
    .slice(0, 8)
    .join('\n')
    .slice(0, 400);
  return kept || 'Un test a échoué. Le fichier de test n’est pas montré.';
}

function safePath(root: string, rel: string): string | null {
  if (!rel || rel.includes('..') || rel.startsWith('/') || rel.includes('\\') || rel.includes('hidden')) return null;
  if (/\.test\.mjs$/.test(rel)) return null;
  const full = join(root, rel);
  const prefix = root.endsWith('/') ? root : `${root}/`;
  if (!full.startsWith(prefix)) return null;
  return full;
}

function nodeProcess(): { execPath: string; version: string; env: { PATH?: string } } {
  return (globalThis as unknown as { process: { execPath: string; version: string; env: { PATH?: string } } }).process;
}

async function dirBytes(root: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string) => {
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      const full = join(dir, name);
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) await walk(full);
      else total += info.size;
    }
  };
  await walk(root);
  return total;
}

async function listRel(dir: string, prefix = ''): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: string[] = [];
  for (const name of names) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) out.push(...(await listRel(join(dir, name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

async function applyTool(root: string, call: ToolCall): Promise<string> {
  if (call.name === 'list_files') return (await listRel(root)).join('\n') || '(vide)';
  if (call.name === 'read_file') {
    const full = safePath(root, String(call.arguments.path ?? ''));
    if (!full) return 'chemin refusé';
    return readFile(full, 'utf8').catch(() => 'fichier absent');
  }
  if (call.name === 'write_file') {
    const rel = String(call.arguments.path ?? '');
    const full = safePath(root, rel);
    const content = String(call.arguments.content ?? '');
    if (!full) return 'chemin refusé';
    if (new TextEncoder().encode(content).byteLength > LAB_LIMITS.maxFileBytes) return 'fichier trop grand';
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
    if ((await dirBytes(root)) > LAB_LIMITS.maxDirBytes) {
      await rm(full, { force: true });
      return 'dossier de travail trop grand';
    }
    return 'écrit';
  }
  return 'outil refusé';
}

function fenceWrite(text: string, mission: LabMission): { path: string; content: string } | null {
  if (mission.starterFiles.length !== 1) return null;
  const match = /```(?:javascript|js|mjs)?\n([\s\S]*?)```/.exec(text);
  const content = match?.[1]?.trim();
  if (!content || content.length < 8) return null;
  return { path: mission.starterFiles[0]!.path, content: `${content}\n` };
}

export async function executeHiddenTests(
  workRoot: string,
  mission: LabMission,
): Promise<{ exitCode: number | null; output: string; broken: boolean }> {
  const verify = join(workRoot, '..', `verify-${mission.id}-${Date.now()}`);
  try {
    await mkdir(verify, { recursive: true });
    for (const rel of await listRel(workRoot)) {
      const text = await readFile(join(workRoot, rel), 'utf8');
      const dest = join(verify, rel);
      await mkdir(join(dest, '..'), { recursive: true });
      await writeFile(dest, text);
    }
    for (const hidden of mission.hiddenTests) {
      const dest = join(verify, hidden.path);
      await mkdir(join(dest, '..'), { recursive: true });
      await writeFile(dest, hidden.content);
    }
    const testFile = mission.hiddenTests[0]!.path;
    const node = nodeProcess();
    const result = spawnSync(node.execPath, ['--test', testFile], {
      cwd: verify,
      encoding: 'utf8',
      timeout: 15_000,
      env: { PATH: node.env.PATH ?? '' },
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const exitCode = result.error ? null : result.status;
    const broken = exitCode === null || /ERR_MODULE_NOT_FOUND|Cannot find module/.test(output);
    return { exitCode, output, broken };
  } finally {
    await rm(verify, { recursive: true, force: true });
  }
}

function promptOf(brief: LabBrief, skillText: string, feedback: string): string {
  const files = brief.files.map((file) => `Fichier ${file.path} :\n${file.content}`).join('\n\n');
  return [
    brief.goal,
    brief.constraints.length ? `Contraintes :\n${brief.constraints.join('\n')}` : '',
    brief.passCriteria.length ? `Critères :\n${brief.passCriteria.join('\n')}` : '',
    skillText ? `Étapes d’une compétence, sans solution :\n${skillText}` : '',
    files,
    feedback ? `Échec précédent, sans le test :\n${feedback}` : '',
    'Écris le fichier avec write_file. N’affirme pas que c’est réussi.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function evidenceFor(input: {
  mission: LabMission;
  attempts: LabAttempt[];
  files: LabFile[];
  prompt: string;
  model: string;
  synthetic: boolean;
}): MissionEvidence {
  const last = input.attempts.at(-1);
  const paths = input.files.map((file) => file.path);
  const starter = new Map(input.mission.starterFiles.map((file) => [file.path, file.content]));
  const diff = input.files
    .map((file) => {
      const before = starter.get(file.path) ?? '';
      return `${file.path}\n---\n${before}\n+++\n${file.content}`;
    })
    .join('\n');
  const passed = last?.exitCode === 0 && (last.failed ?? 1) === 0 && (last.testsRan ?? 0) > 0;
  return judgeMissionEvidence({
    id: input.mission.id,
    at: Date.now(),
    goal: input.mission.goal,
    passCriteria: input.mission.passCriteria,
    kind: 'programming',
    declaredSuccess: false,
    initialState: `départ : ${input.mission.starterFiles.map((file) => file.path).join(', ')}`,
    filesCreated: paths.filter((path) => !starter.has(path)),
    filesChanged: paths.filter((path) => starter.has(path)),
    diff,
    deliveredPaths: paths,
    commands: input.attempts.map((attempt, index) => ({
      command: `node --test (essai ${index + 1})`,
      exitCode: attempt.exitCode,
      excerpt: attempt.summary,
    })),
    checks: [
      {
        name: 'hidden',
        kind: 'test',
        required: true,
        ran: last?.exitCode !== null && last?.exitCode !== undefined,
        passed: last?.exitCode == null ? null : passed,
        exitCode: last?.exitCode ?? null,
        testsRan: last?.testsRan ?? null,
        reason: last?.summary,
      },
    ],
    finalResult: passed ? 'Les tests cachés sont au vert.' : last?.summary || '',
    toolVersion: nodeProcess().version,
    model: input.model,
    limits: [
      input.synthetic ? 'Ligne synthétique de test unitaire, hors du jeu réel.' : 'Mission de laboratoire, pas une règle générale.',
      'Les tests cachés ne sont pas dans le brief.',
    ],
    audit: [`brief=${input.prompt.length} caractères`, `essais=${input.attempts.length}`],
  });
}

export async function runLabMission(input: {
  mission: LabMission;
  model: LabModel;
  arm: 'alone' | 'skill';
  workRoot: string;
  synthetic?: boolean;
  skillSteps?: readonly string[];
  origins?: readonly { missionId?: string; goal?: string; skillId?: string }[];
  records?: readonly LearningRecord[];
  maxAttempts?: number;
  timeoutMs?: number;
}): Promise<LabRunResult> {
  const mission = input.mission;
  const shape = validateLabMission(mission);
  const contaminated = labContamination(mission, input.origins ?? []);
  const base = {
    missionId: mission.id,
    arm: input.arm,
    synthetic: input.synthetic === true,
    attempts: [] as LabAttempt[],
    modelCalls: 0,
    prompt: '',
    promptHasHidden: false,
    files: [] as LabFile[],
    evidence: null as MissionEvidence | null,
    declaredSuccess: false,
  };
  if (!shape.ok) {
    return { ...base, excluded: true, excludeReason: shape.reason, status: 'rejected', reason: shape.reason };
  }
  const selected =
    input.arm === 'skill' && input.records?.length
      ? selectSkill(input.records, {
          query: mission.goal,
          language: 'javascript',
          source: mission.starterFiles.map((file) => file.content).join('\n'),
        })
      : null;
  const steps = input.skillSteps ?? selected?.skill?.steps ?? [];
  const skill = input.arm === 'skill' ? skillBrief(steps, mission.hiddenTests) : { text: '', leaked: false };
  if (skill.leaked || contaminated) {
    const reason = skill.leaked ? 'fuite dans la compétence' : contaminated!;
    return {
      ...base,
      excluded: true,
      excludeReason: reason,
      status: 'rejected',
      reason,
      promptHasHidden: skill.leaked,
    };
  }

  await rm(input.workRoot, { recursive: true, force: true });
  await mkdir(input.workRoot, { recursive: true });
  for (const file of mission.starterFiles) {
    const dest = join(input.workRoot, file.path);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, file.content);
  }
  const screen = await executeHiddenTests(input.workRoot, mission);
  const screenCount = countNodeTests(screen.output);
  if (screen.broken || screen.exitCode === null || screenCount.total === null) {
    const reason = 'tests cachés cassés ou sans décompte : mission écartée des statistiques';
    return { ...base, excluded: true, excludeReason: reason, status: 'rejected', reason };
  }
  if (screen.exitCode === 0 && screenCount.failed === 0) {
    const reason = 'les tests passent déjà sur le fichier de départ : mission écartée';
    return { ...base, excluded: true, excludeReason: reason, status: 'rejected', reason };
  }

  const maxAttempts = input.maxAttempts ?? LAB_LIMITS.maxAttempts;
  let feedback = '';
  const attempts: LabAttempt[] = [];
  let prompt = '';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    prompt = promptOf(labBrief(mission), skill.text, feedback);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? LAB_LIMITS.timeoutMs);
    const messages: ChatMessage[] = [
      { id: 'user', role: 'user', content: prompt, createdAt: Date.now() },
    ];
    let rounds = 0;
    try {
      while (rounds < LAB_LIMITS.maxRounds) {
        rounds += 1;
        let reply: { text: string; toolCalls: ToolCall[] };
        try {
          reply = await input.model.complete({
            system: 'Tu n’as pas les tests. Écris le code avec write_file. N’annonce pas un succès.',
            messages,
            signal: controller.signal,
          });
        } catch {
          base.modelCalls += 1;
          break;
        }
        base.modelCalls += 1;
        if (reply.toolCalls.length === 0) {
          const fence = fenceWrite(reply.text, mission);
          if (fence) await applyTool(input.workRoot, { id: 'fence', name: 'write_file', arguments: fence });
          break;
        }
        messages.push({
          id: `a${rounds}`,
          role: 'assistant',
          content: reply.text,
          toolCalls: reply.toolCalls,
          createdAt: Date.now(),
        });
        for (const call of reply.toolCalls) {
          const content = await applyTool(input.workRoot, call);
          messages.push({
            id: `t${rounds}-${call.id}`,
            role: 'tool',
            content,
            toolCallId: call.id,
            toolName: call.name,
            createdAt: Date.now(),
          });
        }
      }
    } finally {
      clearTimeout(timer);
    }
    const run = await executeHiddenTests(input.workRoot, mission);
    const counts = countNodeTests(run.output);
    const summary =
      run.exitCode === null
        ? 'pas de code de sortie'
        : counts.total === null
          ? 'la sortie ne dit pas combien de tests ont tourné'
          : counts.failed
            ? `${counts.failed} test(s) échoué(s) sur ${counts.total}`
            : `${counts.total} tests réussis`;
    const shown = run.exitCode === 0 ? '' : sanitizeTestFeedback(run.output);
    const regressionFailed = /✖[^\n]*fee inchangé/.test(run.output);
    attempts.push({
      exitCode: run.exitCode,
      testsRan: counts.total,
      failed: counts.failed,
      summary,
      shownToModel: shown,
      regressionFailed,
    });
    if (run.exitCode === 0 && counts.failed === 0 && counts.total) break;
    feedback = shown;
  }

  const files: LabFile[] = [];
  for (const rel of await listRel(input.workRoot)) {
    files.push({ path: rel, content: await readFile(join(input.workRoot, rel), 'utf8') });
  }
  const promptHasHidden = mission.hiddenTests.some((file) => prompt.includes(file.content.trim()));
  const evidence = evidenceFor({
    mission,
    attempts,
    files,
    prompt,
    model: `${input.model.name} ${input.model.digest.slice(0, 12)}`,
    synthetic: input.synthetic === true,
  });
  const row = classifyLabRow({
    evidence,
    declaredSuccess: false,
    leak: promptHasHidden,
    duplicate: false,
    contaminated: false,
    synthetic: input.synthetic === true,
    acceptedByGates: false,
  });
  return {
    ...base,
    excluded: false,
    excludeReason: null,
    attempts,
    prompt,
    promptHasHidden,
    files,
    evidence,
    status: row.status,
    reason: row.reason,
  };
}

export async function probeLabModel(fetchImpl: typeof fetch = fetch): Promise<
  { ok: true; name: string; digest: string } | { ok: false; reason: string }
> {
  try {
    const response = await fetchImpl('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { ok: false, reason: 'Ollama ne répond pas : série bloquée' };
    const body = (await response.json()) as { models?: { name?: string; digest?: string }[] };
    const found = (body.models ?? []).find((model) => model.name === LAB_MODEL_NAME);
    if (!found?.digest) return { ok: false, reason: `${LAB_MODEL_NAME} est absent : série bloquée, aucun score inventé` };
    if (!found.digest.startsWith(LAB_MODEL_DIGEST_PREFIX)) {
      return { ok: false, reason: `digest inattendu pour ${LAB_MODEL_NAME} : série bloquée` };
    }
    return { ok: true, name: LAB_MODEL_NAME, digest: found.digest };
  } catch {
    return { ok: false, reason: 'Ollama est injoignable : série bloquée' };
  }
}

export function ollamaLabModel(digest: string, fetchImpl?: typeof fetch): LabModel {
  const provider = new OllamaProvider({
    provider: 'ollama',
    model: LAB_MODEL_NAME,
    baseUrl: 'http://127.0.0.1:11434',
    ollama: { numCtx: LAB_LIMITS.numCtx, think: false, keepAlive: '10m' },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  return {
    name: LAB_MODEL_NAME,
    digest,
    async complete(input) {
      let text = '';
      const toolCalls: ToolCall[] = [];
      for await (const event of provider.streamChat({
        system: input.system,
        messages: input.messages,
        tools: TOOLS,
        temperature: LAB_LIMITS.temperature,
        maxTokens: LAB_LIMITS.numPredict,
        signal: input.signal,
      })) {
        if (event.type === 'text') text += event.delta;
        if (event.type === 'tool_call') toolCalls.push(event.call);
        if (event.type === 'error') throw new Error(event.message);
      }
      return { text, toolCalls };
    },
  };
}

export interface LabBatchRow {
  id: string;
  level: LabLevel;
  category: string;
  split: string;
  arm: 'alone' | 'skill';
  excluded: boolean;
  excludeReason: string | null;
  attempts: number;
  modelCalls: number;
  passed: boolean;
  firstTryPassed: boolean;
  exitCode: number | null;
  regressionFailed: boolean | null;
  status: LabRowStatus;
  reason: string;
  synthetic: boolean;
  evidenceId: string | null;
  prompt: string;
  promptHasHidden: boolean;
  verifiedWithoutExit: boolean;
}

export function labJournalMission(mission: LabMission, result: LabRunResult, now = Date.now()): MissionState | null {
  if (!result.evidence) return null;
  const state = createMission({
    id: `${mission.id}-${result.arm}`,
    projectId: 'laboratoire',
    kind: 'fix',
    request: mission.goal,
    skipQuestions: true,
    now,
  });
  state.evidence = { ...result.evidence, id: state.id };
  state.verdict = missionVerdictFromEvidence(result.evidence.status);
  state.status = state.verdict === 'success' ? 'finished' : result.excluded ? 'cancelled' : 'failed';
  state.summary = result.reason;
  return state;
}

function batchRow(mission: LabMission, result: LabRunResult): LabBatchRow {
  const passed = result.evidence?.status === 'success_verified';
  const first = result.attempts[0];
  return {
    id: mission.id,
    level: mission.level,
    category: mission.category,
    split: mission.split,
    arm: result.arm,
    excluded: result.excluded,
    excludeReason: result.excludeReason,
    attempts: result.attempts.length,
    modelCalls: result.modelCalls,
    passed,
    firstTryPassed: Boolean(first && first.exitCode === 0 && first.failed === 0 && (first.testsRan ?? 0) > 0),
    exitCode: result.attempts.at(-1)?.exitCode ?? null,
    regressionFailed: mission.id === 'l3-quote-fee' ? (result.attempts.at(-1)?.regressionFailed ?? null) : null,
    status: result.status,
    reason: result.reason,
    synthetic: result.synthetic,
    evidenceId: result.evidence?.id ?? null,
    prompt: result.prompt,
    promptHasHidden: result.promptHasHidden,
    verifiedWithoutExit: passed && result.attempts.at(-1)?.exitCode !== 0,
  };
}

function skillStepsFor(
  mission: LabMission,
  records: readonly LearningRecord[],
): { leaked: boolean; steps: string[] } | null {
  if (records.length === 0) return null;
  const found = selectSkill(records, {
    query: mission.goal,
    language: 'javascript',
    source: mission.starterFiles.map((file) => file.content).join('\n'),
    validatedOnly: true,
  });
  const steps = found?.skill?.steps ?? [];
  if (steps.length === 0) return null;
  return { leaked: skillBrief(steps, mission.hiddenTests).leaked, steps };
}

export async function runLabBatch(input: {
  model: LabModel;
  workParent: string;
  journalSave?: (mission: MissionState) => Promise<void>;
  maxLevel?: LabLevel;
  origins?: readonly { missionId?: string; goal?: string; skillId?: string }[];
  records?: readonly LearningRecord[];
}): Promise<{ blocked: false; rows: LabBatchRow[]; levels: Record<LabLevel, { ran: boolean; sound: boolean }> }> {
  const rows: LabBatchRow[] = [];
  const levels: Record<LabLevel, { ran: boolean; sound: boolean }> = {
    1: { ran: false, sound: false },
    2: { ran: false, sound: false },
    3: { ran: false, sound: false },
  };
  const cap = input.maxLevel ?? 3;
  const priorGoals: { goal: string }[] = [];
  for (const level of [1, 2, 3] as const) {
    if (level > cap) break;
    if (level === 2 && !levels[1].sound) break;
    if (level === 3 && !levels[2].sound) break;
    levels[level].ran = true;
    for (const mission of missionsForLevel(level)) {
      const origins = [...(input.origins ?? []), ...priorGoals];
      const result = await runLabMission({
        mission,
        model: input.model,
        arm: 'alone',
        workRoot: join(input.workParent, `${mission.id}-alone`),
        origins,
      });
      rows.push(batchRow(mission, result));
      const journal = labJournalMission(mission, result);
      if (input.journalSave && journal) await input.journalSave(journal);
      const skillSteps = skillStepsFor(mission, input.records ?? []);
      if (skillSteps?.leaked) {
        const leaked = await runLabMission({
          mission,
          model: input.model,
          arm: 'skill',
          workRoot: join(input.workParent, `${mission.id}-skill`),
          origins,
          skillSteps: skillSteps.steps,
        });
        rows.push(batchRow(mission, leaked));
      } else if (skillSteps) {
        const skilled = await runLabMission({
          mission,
          model: input.model,
          arm: 'skill',
          workRoot: join(input.workParent, `${mission.id}-skill`),
          origins,
          records: input.records,
          skillSteps: skillSteps.steps,
        });
        rows.push(batchRow(mission, skilled));
        const skilledJournal = labJournalMission(mission, skilled);
        if (input.journalSave && skilledJournal) await input.journalSave(skilledJournal);
      }
      priorGoals.push({ goal: mission.goal });
    }
    levels[level].sound = levelSound(rows.filter((row) => row.level === level && row.arm === 'alone'));
  }
  return { blocked: false, rows, levels };
}
