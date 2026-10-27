/**
 * Exécution du laboratoire. Ce fichier n’est pas exporté par l’index :
 * la fenêtre ne doit pas embarquer node:fs. Le modèle est injecté ;
 * ollamaLabModel parle au fournisseur déjà sur la machine.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { createMission, type MissionState } from './engine/mission.js';
import { judgeMissionEvidence, missionVerdictFromEvidence, type MissionEvidence } from './evidence.js';
import { selectSkill } from '../learning/skills.js';
import type { LearningRecord } from '../learning/continuous.js';
import { OllamaProvider, RECOVERED_CALL_PREFIX } from '../providers/ollama.js';
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
  toolFeedback: string;
  /** Sortie brute du test, pour le journal. Elle n’est pas renvoyée au modèle. */
  testOutput: string;
  filesBefore: LabFile[];
  filesAfter: LabFile[];
  regressionFailed?: boolean;
  /** 5.0.54 : diagnostic de l'essai (le banc dit pourquoi il échoue). */
  wrote?: boolean;
  recoveredCalls?: number;
  fenceUsed?: boolean;
  modelError?: string;
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
  /** Tests cachés verts sur les fichiers finaux. Indépendant du jeu et de la compétence. */
  technicalSuccess: boolean;
  /** Porte compétence, inchangée. Un succès technique ne l’ouvre pas. */
  skillAdmission: 'candidate' | 'refused' | 'one-file' | 'duplicate' | 'none';
  /** Porte du jeu, inchangée. Un succès technique ne devient pas une ligne. */
  trainingAdmission: 'candidate' | 'accepted' | 'rejected' | 'none';
}

/** Outils montrés au modèle du laboratoire (exportés pour les exemples d'entraînement, 5.0.55). */
export const LAB_TOOLS = [
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
    description: 'Écrit un chemin relatif autorisé du dossier, ou un chemin absolu déjà dans ce dossier. Pas de test.',
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

function yamlScalar(value: string): string {
  const text = value.trim();
  return text === '~' ? 'null' : text;
}

/** Contrôle échoué et message, sans le fichier de test et sans le correctif. */
export function sanitizeTestFeedback(output: string): string {
  const blocks: string[] = [];
  for (const chunk of output.split(/\r?\n(?=not ok )/g)) {
    const title = /^not ok \d+ - (.+)$/m.exec(chunk);
    if (!title) continue;
    const lines = [`Contrôle échoué : ${title[1]!.trim()}`];
    const inline = /^[ ]*error:\s*'([^']*)'/m.exec(chunk);
    const folded = /^[ ]*error:\s*\|-\s*\n([\s\S]*?)\n[ ]*code:/m.exec(chunk);
    const errorBody = (inline?.[1] ?? folded?.[1] ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    if (errorBody) lines.push(errorBody);
    const expected = /^[ ]*expected:\s*(.+)$/m.exec(chunk);
    const actual = /^[ ]*actual:\s*(.+)$/m.exec(chunk);
    const errName = /^[ ]*name:\s*'([^']+)'/m.exec(chunk);
    if (expected) lines.push(`expected: ${yamlScalar(expected[1]!)}`);
    if (actual) lines.push(`actual: ${yamlScalar(actual[1]!)}`);
    if (errName && errName[1] !== 'AssertionError') lines.push(`name: ${errName[1]}`);
    const text = lines.filter((line) => !/hidden\/|\.test\.mjs|assert\.|node:test|node:internal/.test(line)).join('\n');
    if (text) blocks.push(text);
  }
  const kept = blocks.join('\n').slice(0, 700);
  return kept || 'Un test a échoué. Le fichier de test n’est pas montré.';
}

function crashSet(output: string): Set<string> {
  const found = new Set<string>();
  for (const match of output.matchAll(/^[ \t]*name:\s*'([^']+)'/gm)) {
    const name = match[1];
    if (name && name !== 'AssertionError') found.add(name);
  }
  if (/\bSyntaxError\b/.test(output)) found.add('SyntaxError');
  return found;
}

function regressed(
  before: { failed: number; crashes: ReadonlySet<string> },
  run: { exitCode: number | null; output: string },
): boolean {
  if (run.exitCode === null) return true;
  const counts = countNodeTests(run.output);
  if (counts.failed === null) return true;
  if (counts.failed > before.failed) return true;
  for (const name of crashSet(run.output)) {
    if (!before.crashes.has(name)) return true;
  }
  return false;
}

function regressionNote(
  before: { failed: number; crashes: ReadonlySet<string> },
  run: { exitCode: number | null; output: string },
): string {
  const counts = countNodeTests(run.output);
  const crashes = [...crashSet(run.output)].filter((name) => !before.crashes.has(name));
  const bits: string[] = [];
  if (counts.failed !== null && counts.failed > before.failed) bits.push(`${counts.failed} échecs contre ${before.failed}`);
  if (crashes.length > 0) bits.push(`plantage ${crashes.join(', ')}`);
  if (run.exitCode === null || counts.failed === null) bits.push('sortie de test inutilisable');
  return `Régression : ${bits.join(' ; ') || 'échec aggravé'}. Les octets précédents sont gardés.`;
}

type PathApi = {
  readonly sep: string;
  isAbsolute(path: string): boolean;
  resolve(...paths: string[]): string;
  relative(from: string, to: string): string;
};

/** Racine ou demande au format Windows. Sur Linux, ce n’est pas un disque : seulement la règle de chemin. */
function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

/**
 * Résout avec les règles POSIX ou Windows. Un chemin d’un autre système n’est pas
 * recopié dans la racine. `..` qui sort, et un préfixe voisin, sont refusés.
 */
function resolveWith(
  api: PathApi,
  root: string,
  requested: string,
): { ok: true; full: string; relative: string } | { ok: false } {
  if (!requested || requested.includes('\0')) return { ok: false };
  if (api.sep === '/' && requested.includes('\\')) return { ok: false };
  const rootAbsolute = api.resolve(root);
  const full = api.isAbsolute(requested) ? api.resolve(requested) : api.resolve(rootAbsolute, requested);
  const relativeNative = api.relative(rootAbsolute, full);
  if (
    !relativeNative ||
    relativeNative === '..' ||
    relativeNative.startsWith(`..${api.sep}`) ||
    api.isAbsolute(relativeNative)
  ) {
    return { ok: false };
  }
  const relative = relativeNative.split(api.sep).join('/');
  if (relative.toLowerCase().includes('hidden') || relative.toLowerCase().endsWith('.test.mjs')) return { ok: false };
  return { ok: true, full, relative };
}

/** Chemin relatif, ou absolu déjà dans la racine. Un chemin étranger n’est pas réécrit dedans. */
export function resolveWorkPath(
  root: string,
  requested: string,
): { ok: true; full: string; relative: string } | { ok: false } {
  if (!requested || requested.includes('\0')) return { ok: false };
  if (!isWindowsPath(root) && isWindowsPath(requested)) return { ok: false };
  const api: PathApi = isWindowsPath(root) || isWindowsPath(requested) ? win32 : posix;
  return resolveWith(api, root, requested);
}

function hostIsWindows(): boolean {
  const platform = (globalThis as unknown as { process?: { platform?: string } }).process?.platform;
  return platform === 'win32';
}

function isAllowedLabPath(path: string, allowed: readonly string[]): boolean {
  const normalized = path.replace(/\\/g, '/');
  return allowed.some((candidate) => {
    const expected = candidate.replace(/\\/g, '/');
    return hostIsWindows() ? normalized.toLowerCase() === expected.toLowerCase() : normalized === expected;
  });
}

function pathRefusal(requested: string, allowed: readonly string[]): string {
  return `chemin refusé : ${requested || '(vide)'} n’est pas un chemin de fichier autorisé dans le dossier. Chemin autorisé : ${allowed.join(', ')}`;
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

async function readAllowed(root: string, allowed: readonly string[]): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  for (const path of allowed) {
    const resolved = resolveWorkPath(root, path);
    found.set(path, resolved.ok ? await readFile(resolved.full, 'utf8').catch(() => null) : null);
  }
  return found;
}

function sameBytes(left: Map<string, string | null>, right: Map<string, string | null>, allowed: readonly string[]): boolean {
  return allowed.every((path) => left.get(path) === right.get(path));
}

function stripFileEnd(value: string): string {
  return value.replace(/[ \t\r\n]+$/g, '');
}

/** Même corps : seul le blanc final a bougé. Ce n’est pas une correction. */
function bodyDelta(before: string, after: string): 'same' | 'newline' | 'changed' {
  if (before === after) return 'same';
  if (stripFileEnd(before) === stripFileEnd(after)) return 'newline';
  return 'changed';
}

function importedLocals(source: string): string[] {
  const names: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('import ')) continue;
    const clause = /^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/.exec(trimmed)?.[1]?.trim();
    if (!clause) continue;
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) {
      for (const part of named[1]!.split(',')) {
        const bits = part.trim().split(/\s+as\s+/);
        const local = (bits[bits.length - 1] ?? '').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
      }
    }
    const star = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (star?.[1]) names.push(star[1]);
    const rest = clause
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\*\s+as\s+[A-Za-z_$][\w$]*/g, ' ')
      .replace(/,/g, ' ')
      .trim();
    if (/^[A-Za-z_$][\w$]*$/.test(rest)) names.push(rest);
  }
  return names;
}

function definesName(source: string, name: string): boolean {
  return new RegExp(`(?:function|class|const|let|var)\\s+${name}\\b`).test(source);
}

function usesName(source: string, name: string): boolean {
  const body = source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('import '))
    .join('\n');
  return new RegExp(`\\b${name}\\b`).test(body);
}

/** Noms d’import retirés, encore utilisés, et sans autre lien dans le fichier. */
function unresolvedImportedNames(before: string, after: string): string[] {
  const kept = new Set(importedLocals(after));
  const missing = importedLocals(before).filter((name) => !kept.has(name));
  return [...new Set(missing.filter((name) => usesName(after, name) && !definesName(after, name)))];
}

async function applyTool(root: string, call: ToolCall, allowed: readonly string[]): Promise<string> {
  if (call.name === 'list_files') return (await listRel(root)).join('\n') || '(vide)';
  if (call.name === 'read_file') {
    const requested = String(call.arguments.path ?? '');
    const resolved = resolveWorkPath(root, requested);
    if (!resolved.ok || !isAllowedLabPath(resolved.relative, allowed)) {
      return pathRefusal(requested, allowed);
    }
    return readFile(resolved.full, 'utf8').catch(() => 'fichier absent');
  }
  if (call.name === 'write_file') {
    const requested = String(call.arguments.path ?? '');
    const resolved = resolveWorkPath(root, requested);
    if (!resolved.ok || !isAllowedLabPath(resolved.relative, allowed)) {
      return pathRefusal(requested, allowed);
    }
    const content = String(call.arguments.content ?? '');
    if (new TextEncoder().encode(content).byteLength > LAB_LIMITS.maxFileBytes) return 'fichier trop grand';
    const before = await readAllowed(root, allowed);
    const previous = await readFile(resolved.full, 'utf8').catch(() => null);
    await mkdir(join(resolved.full, '..'), { recursive: true });
    await writeFile(resolved.full, content);
    if ((await dirBytes(root)) > LAB_LIMITS.maxDirBytes) {
      if (previous === null) await rm(resolved.full, { force: true });
      else await writeFile(resolved.full, previous, 'utf8');
      return 'dossier de travail trop grand';
    }
    const unresolved = unresolvedImportedNames(previous ?? '', content);
    if (unresolved.length > 0) {
      if (previous === null) await rm(resolved.full, { force: true });
      else await writeFile(resolved.full, previous, 'utf8');
      const names = unresolved.join(', ');
      const detail =
        unresolved.length === 1
          ? `${names} est utilisé et le fichier ne le résout pas`
          : `${names} sont utilisés et le fichier ne les résout pas`;
      return `vérification : import encore nécessaire, ${detail}. Écriture annulée, les octets précédents sont gardés.`;
    }
    const after = await readAllowed(root, allowed);
    if (allowed.some((path) => after.get(path) == null)) {
      return `vérification : un fichier attendu est absent. Chemin autorisé : ${allowed.join(', ')}`;
    }
    if (sameBytes(before, after, allowed)) {
      return `vérification : ${allowed.join(', ')} n’a pas changé. Chemin autorisé : ${allowed.join(', ')}`;
    }
    const written = after.get(resolved.relative) ?? content;
    if (bodyDelta(previous ?? '', written) === 'newline') {
      return `relecture : seul un saut de ligne final a changé dans ${resolved.relative}. Le corps est resté le même. Ce n’est pas une correction.`;
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

let verifySerial = 0;

export async function executeHiddenTests(
  workRoot: string,
  mission: LabMission,
): Promise<{ exitCode: number | null; output: string; broken: boolean }> {
  const verify = join(workRoot, '..', `verify-${mission.id}-${Date.now()}-${verifySerial += 1}`);
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

/** Consigne courte des exemples d'entraînement (5.0.56). */
export const LAB_SYSTEM_PROMPT =
  'Tu n’as pas les tests. Écris le code avec write_file sur le chemin relatif indiqué. N’annonce pas un succès.';

/** Consigne du modèle : chemins autorisés, saut de ligne, import. */
export function labSystemPrompt(allowed: readonly string[]): string {
  return `Tu n’as pas les tests. Écris le code avec write_file en utilisant exclusivement un chemin relatif autorisé : ${allowed.join(', ')}. N’utilise jamais un chemin hors de cette liste. Si un outil refuse le chemin, relis son retour puis réessaie avec le chemin autorisé. Un saut de ligne final seul n’est pas une correction. Ne retire pas un import dont le nom est encore utilisé et non résolu. Ne prétends pas que les tests passent et n’annonce pas un succès.`;
}

/** Demande du premier essai, sans retour de test ni compétence : celle d'un exemple d'entraînement. */
export function labFirstPrompt(mission: LabMission): string {
  return promptOf(labBrief(mission), '', '');
}

function promptOf(brief: LabBrief, skillText: string, feedback: string, currentFiles?: readonly LabFile[]): string {
  const files = (currentFiles ?? brief.files).map((file) => `Fichier ${file.path} :\n${file.content}`).join('\n\n');
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

async function readAllowedFile(root: string, path: string): Promise<string | null> {
  const resolved = resolveWorkPath(root, path);
  if (!resolved.ok) return null;
  return readFile(resolved.full, 'utf8').catch(() => null);
}

async function snapshotAllowed(root: string, allowed: readonly string[]): Promise<LabFile[]> {
  const files: LabFile[] = [];
  for (const path of allowed) {
    files.push({ path, content: (await readAllowedFile(root, path)) ?? '' });
  }
  return files;
}

/** Confirmation de cet essai seulement. Un saut de ligne final n’est pas une correction. */
function landedLine(path: string, before: string | null, after: string | null): string {
  if (after == null) return `Chemin ${path} : fichier absent après l’essai.`;
  const delta = bodyDelta(before ?? '', after);
  if (delta === 'newline') {
    return `Chemin ${path} : seul un saut de ligne final a changé. Le corps relu est le même. Ce n’est pas une correction.`;
  }
  if (delta === 'changed') return `Chemin ${path} : écriture confirmée, le fichier relu a changé.`;
  return `Chemin ${path} : aucune écriture confirmée, le fichier relu est inchangé.`;
}

async function writeAllowed(root: string, files: readonly LabFile[]): Promise<void> {
  for (const file of files) {
    const resolved = resolveWorkPath(root, file.path);
    if (!resolved.ok) continue;
    await mkdir(join(resolved.full, '..'), { recursive: true });
    await writeFile(resolved.full, file.content);
  }
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
    technicalSuccess: false,
    skillAdmission: 'none' as const,
    trainingAdmission: 'none' as const,
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
  let currentFiles: LabFile[] | undefined;
  const attempts: LabAttempt[] = [];
  let prompt = '';
  const allowedPaths = mission.starterFiles.map((file) => file.path);
  let keptFiles = await snapshotAllowed(input.workRoot, allowedPaths);
  let keptFailed = screenCount.failed ?? 0;
  let keptCrashes = crashSet(screen.output);
  const anchor = () => ({ failed: keptFailed, crashes: keptCrashes });
  const frozenWrite = (message: string) =>
    message.includes('Écriture annulée') ||
    message.includes('n’a pas changé') ||
    message.includes('fichier attendu est absent') ||
    message.includes('trop grand');
  const reviewLandedWrite = async (
    toolMessage: string,
  ): Promise<{ message: string; regression: boolean; passed: boolean }> => {
    if (!/^(écrit|relecture|vérification)/.test(toolMessage)) {
      return { message: toolMessage, regression: false, passed: false };
    }
    const runNow = await executeHiddenTests(input.workRoot, mission);
    const countsNow = countNodeTests(runNow.output);
    const passed = runNow.exitCode === 0 && countsNow.failed === 0 && (countsNow.total ?? 0) > 0;
    if (regressed(anchor(), runNow)) {
      await writeAllowed(input.workRoot, keptFiles);
      return { message: `${toolMessage}\n${regressionNote(anchor(), runNow)}`, regression: true, passed: false };
    }
    if (!frozenWrite(toolMessage)) {
      keptFiles = await snapshotAllowed(input.workRoot, allowedPaths);
      if (countsNow.failed !== null) keptFailed = countsNow.failed;
      keptCrashes = crashSet(runNow.output);
    }
    const reread = (await snapshotAllowed(input.workRoot, allowedPaths))
      .map((file) => `Relecture ${file.path} :\n${file.content}`)
      .join('\n\n');
    const shownNow = passed ? '' : sanitizeTestFeedback(runNow.output);
    return { message: [toolMessage, reread, shownNow].filter(Boolean).join('\n'), regression: false, passed };
  };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const filesBefore = await snapshotAllowed(input.workRoot, allowedPaths);
    prompt = promptOf(labBrief(mission), skill.text, feedback, attempt === 0 ? undefined : currentFiles);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? LAB_LIMITS.timeoutMs);
    const messages: ChatMessage[] = [
      { id: 'user', role: 'user', content: prompt, createdAt: Date.now() },
    ];
    let rounds = 0;
    let wrote = false;
    let fenceUsed = false;
    let recoveredCalls = 0;
    let modelError: string | undefined;
    const notes: string[] = [];
    const allowed = mission.starterFiles.map((file) => file.path);
    const remember = (content: string) => {
      for (const line of content.split(/\r?\n/)) {
        if (/^(chemin refusé|vérification|fichier trop grand|dossier de travail trop grand|outil refusé|fichier absent|relecture|Régression)/i.test(line)) {
          notes.push(line);
        }
      }
    };
    let abortedRegression = false;
    let solved = false;
    try {
      while (rounds < LAB_LIMITS.maxRounds && !abortedRegression && !solved) {
        rounds += 1;
        let reply: { text: string; toolCalls: ToolCall[] };
        try {
          reply = await input.model.complete({
            system: labSystemPrompt(allowed),
            messages,
            signal: controller.signal,
          });
        } catch (error) {
          base.modelCalls += 1;
          modelError = controller.signal.aborted
            ? `délai de ${Math.round((input.timeoutMs ?? LAB_LIMITS.timeoutMs) / 1000)} s dépassé`
            : error instanceof Error
              ? error.message.slice(0, 300)
              : String(error).slice(0, 300);
          break;
        }
        base.modelCalls += 1;
        recoveredCalls += reply.toolCalls.filter((call) => call.id.startsWith(RECOVERED_CALL_PREFIX)).length;
        if (reply.toolCalls.length === 0) {
          const fence = fenceWrite(reply.text, mission);
          if (fence) {
            fenceUsed = true;
            const written = await applyTool(input.workRoot, { id: 'fence', name: 'write_file', arguments: fence }, allowed);
            if (written === 'écrit') wrote = true;
            const reviewed = await reviewLandedWrite(written);
            remember(reviewed.message);
            abortedRegression = reviewed.regression;
            solved = reviewed.passed;
          }
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
          const written = await applyTool(input.workRoot, call, allowed);
          if (call.name === 'write_file' && written === 'écrit') wrote = true;
          const reviewed = await reviewLandedWrite(written);
          remember(reviewed.message);
          messages.push({
            id: `t${rounds}-${call.id}`,
            role: 'tool',
            content: reviewed.message,
            toolCallId: call.id,
            toolName: call.name,
            createdAt: Date.now(),
          });
          abortedRegression = reviewed.regression;
          solved = reviewed.passed;
          if (abortedRegression || solved) break;
        }
      }
    } finally {
      clearTimeout(timer);
    }
    if (abortedRegression) await writeAllowed(input.workRoot, keptFiles);
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
    const toolFeedback = notes.join('\n');
    const filesAfter = await snapshotAllowed(input.workRoot, allowedPaths);
    const beforeByPath = new Map(filesBefore.map((file) => [file.path, file.content]));
    const landed = allowedPaths.map((path) => {
      const after = filesAfter.find((file) => file.path === path)?.content ?? null;
      const before = beforeByPath.get(path) ?? null;
      return landedLine(path, before, after);
    });
    attempts.push({
      exitCode: run.exitCode,
      testsRan: counts.total,
      failed: counts.failed,
      summary,
      shownToModel: shown,
      toolFeedback,
      testOutput: run.output,
      filesBefore,
      filesAfter,
      regressionFailed,
      wrote,
      recoveredCalls,
      fenceUsed,
      ...(modelError ? { modelError } : {}),
    });
    if (run.exitCode === 0 && counts.failed === 0 && counts.total) break;
    if (abortedRegression) break;
    currentFiles = filesAfter;
    feedback = [toolFeedback, shown, ...landed].filter(Boolean).join('\n');
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
  const technicalSuccess = evidence.status === 'success_verified';
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
    technicalSuccess,
    skillAdmission: evidence.skill.action,
    trainingAdmission: evidence.staging.validationStatus,
  };
}

/**
 * Modèle présent sur le serveur local. Le digest n'est imposé que pour le modèle de
 * référence (série comparable) ; un autre modèle est accepté tel qu'installé (5.0.54).
 */
export async function probeLabModel(
  fetchImpl: typeof fetch = fetch,
  modelName: string = LAB_MODEL_NAME,
  baseUrl = 'http://127.0.0.1:11434',
): Promise<{ ok: true; name: string; digest: string } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { ok: false, reason: 'Ollama ne répond pas : série bloquée' };
    const body = (await response.json()) as { models?: { name?: string; digest?: string }[] };
    const wanted = modelName.includes(':') ? modelName : `${modelName}:latest`;
    const found = (body.models ?? []).find((model) => model.name === modelName || model.name === wanted);
    if (!found?.digest) return { ok: false, reason: `${modelName} est absent : série bloquée, aucun score inventé` };
    if (modelName === LAB_MODEL_NAME && !found.digest.startsWith(LAB_MODEL_DIGEST_PREFIX)) {
      return { ok: false, reason: `digest inattendu pour ${LAB_MODEL_NAME} : série bloquée` };
    }
    return { ok: true, name: modelName, digest: found.digest };
  } catch {
    return { ok: false, reason: 'Ollama est injoignable : série bloquée' };
  }
}

export interface LabModelOptions {
  /** Appels d'outils écrits en texte relus (5.0.54). Défaut : oui. `false` = comportement 5.0.53. */
  recoverToolCalls?: boolean;
  numCtx?: number;
  /** `think` n'est envoyé que s'il est défini ; défaut : false (Qwen3 sans réflexion). */
  think?: boolean | null;
  baseUrl?: string;
}

export function ollamaLabModel(
  digest: string,
  fetchImpl?: typeof fetch,
  modelName: string = LAB_MODEL_NAME,
  options: LabModelOptions = {},
): LabModel {
  const think = options.think === undefined ? false : options.think;
  const provider = new OllamaProvider({
    provider: 'ollama',
    model: modelName,
    baseUrl: options.baseUrl ?? 'http://127.0.0.1:11434',
    ollama: {
      numCtx: options.numCtx ?? LAB_LIMITS.numCtx,
      ...(think === null ? {} : { think }),
      keepAlive: '10m',
      recoverToolCalls: options.recoverToolCalls ?? true,
    },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  return {
    name: modelName,
    digest,
    async complete(input) {
      let text = '';
      const toolCalls: ToolCall[] = [];
      for await (const event of provider.streamChat({
        system: input.system,
        messages: input.messages,
        tools: LAB_TOOLS,
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
  /** 5.0.54 : passés à chaque mission (absents : LAB_LIMITS). */
  maxAttempts?: number;
  timeoutMs?: number;
  /** 5.0.54 : appelé après chaque mission (progression du banc). */
  onResult?: (mission: LabMission, result: LabRunResult) => void;
  /** 5.0.55 : missions à lancer (absent : les 9 de référence). Toujours groupées par niveau. */
  missions?: readonly LabMission[];
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
    const pool = input.missions ? input.missions.filter((mission) => mission.level === level) : missionsForLevel(level);
    for (const mission of pool) {
      const origins = [...(input.origins ?? []), ...priorGoals];
      const result = await runLabMission({
        mission,
        model: input.model,
        arm: 'alone',
        workRoot: join(input.workParent, `${mission.id}-alone`),
        origins,
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      });
      rows.push(batchRow(mission, result));
      input.onResult?.(mission, result);
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

/**
 * Exemple d'entraînement tiré d'une mission réussie (5.0.55), au format conversation
 * avec appel d'outil, lisible par les outils d'affinage courants (gabarit de chat de Qwen) :
 * consigne système, demande du premier essai, puis la réponse = `write_file` du fichier
 * final vérifié par les tests cachés. `null` si la mission ne doit pas servir :
 * mission d'évaluation, écartée, non réussie, ou sans fichier changé.
 */
export interface LabTrainingExample {
  id: string;
  messages: [
    { role: 'system'; content: string },
    { role: 'user'; content: string },
    {
      role: 'assistant';
      content: string;
      tool_calls: { type: 'function'; function: { name: 'write_file'; arguments: { path: string; content: string } } }[];
    },
  ];
  tools: { type: 'function'; function: (typeof LAB_TOOLS)[number] }[];
  meta: {
    mission: string;
    level: LabLevel;
    category: string;
    model: string;
    attempts: number;
    firstTry: boolean;
    /** 5.0.56 : `lab` = mission résolue au banc ; `generated` = exercice et solution écrits par le professeur. */
    source?: 'lab' | 'generated';
  };
}

/** Exemple au format commun à partir des fichiers finaux vérifiés (5.0.56). */
export function trainingExampleFromFiles(
  mission: LabMission,
  changed: readonly LabFile[],
  meta: { model: string; attempts: number; source: 'lab' | 'generated' },
): LabTrainingExample {
  return {
    id: `${mission.id}:${meta.model}:${changed.map((item) => item.content.length).join('-')}`,
    messages: [
      { role: 'system', content: LAB_SYSTEM_PROMPT },
      { role: 'user', content: labFirstPrompt(mission) },
      {
        role: 'assistant',
        content: '',
        tool_calls: changed.map((item) => ({
          type: 'function' as const,
          function: { name: 'write_file' as const, arguments: { path: item.path, content: item.content } },
        })),
      },
    ],
    tools: LAB_TOOLS.map((tool) => ({ type: 'function' as const, function: tool })),
    meta: {
      mission: mission.id,
      level: mission.level,
      category: mission.category,
      model: meta.model,
      attempts: meta.attempts,
      firstTry: meta.attempts === 1,
      source: meta.source,
    },
  };
}

export function labTrainingExample(
  mission: LabMission,
  result: LabRunResult,
  options: { trainable: boolean; model: string },
): LabTrainingExample | null {
  if (!options.trainable || mission.split !== 'development') return null;
  if (result.excluded || result.promptHasHidden) return null;
  if (result.evidence?.status !== 'success_verified') return null;
  const last = result.attempts.at(-1);
  if (!last || last.exitCode !== 0 || (last.failed ?? 1) !== 0 || !(last.testsRan ?? 0)) return null;
  const starters = new Map(mission.starterFiles.map((item) => [item.path, item.content]));
  const changed = result.files.filter((item) => starters.has(item.path) && starters.get(item.path) !== item.content);
  if (changed.length === 0) return null;
  return trainingExampleFromFiles(mission, changed, { model: options.model, attempts: result.attempts.length, source: 'lab' });
}
