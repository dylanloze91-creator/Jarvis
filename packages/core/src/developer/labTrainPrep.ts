/**
 * Préparation des données d'entraînement de l'élève (5.0.65). Fichier Node (lit le catalogue
 * d'évaluation et le générateur) : pas exporté par l'index. Aucun modèle n'est appelé.
 *
 * Entrée : les lignes d'`entrainement.jsonl` (exemples écrits par le professeur, format
 * `trainingExampleFromFiles`) et d'`exercices.jsonl` (niveau et thème de chaque exercice).
 * Sortie : un jeu d'entraînement et un jeu de validation, les lignes écartées avec leur raison,
 * et un résumé chiffré. Les lignes gardées sont réécrites **telles quelles** : rien n'est ajouté,
 * reformulé ni corrigé dans une donnée d'entraînement (règle 1 du cahier des charges).
 *
 * Écarts, dans l'ordre : ligne illisible, exemple sans appel `write_file` ou avec un appel non
 * conforme, sans catalogue `tools` (même règle que l'entraînement Python), doublon exact,
 * exemple trop long (jetons estimés), suspect de contamination de l'examen (règle 2 :
 * `labContamination`, noms exportés et objectifs proches des missions d'`evalCatalog()`,
 * solution identique à une solution de référence).
 */
import { labContamination, type LabCategory, type LabFile, type LabLevel, type LabMission } from './lab.js';
import { evalCatalog } from './labCatalog.js';
import { noveltyCheck } from './labGenerator.js';
import type { LabTrainingExample } from './labRunner.js';

export const PREP_DEFAULTS = {
  /** Plafond de longueur d'un exemple, en jetons estimés (consigne + demande + réponse + outils). */
  maxTokens: 3_072,
  /** Part du jeu de validation (10 %), répartie par niveau. */
  validationShare: 0.1,
  /** Graine de la découpe : même cahier, même graine → même découpe. */
  seed: 5065,
  /** En dessous, la préparation est refusée : il faut encore des nuits de génération. */
  minKept: 100,
} as const;

/** Estimation prudente : un jeton pour trois caractères (code et français mêlés). */
export const CHARS_PER_TOKEN = 3;

export interface PrepOptions {
  maxTokens?: number;
  validationShare?: number;
  seed?: number;
  minKept?: number;
}

/** Ce qu'`exercices.jsonl` apporte à un exemple : son niveau réel, son thème, son objectif. */
export interface ExerciseInfo {
  level: LabLevel;
  category?: LabCategory;
  theme?: string;
  goal?: string;
}

export interface PreparedExample {
  /** Ligne d'origine, réécrite à l'identique. */
  line: string;
  id: string;
  mission: string;
  level: LabLevel;
  theme: string | null;
  tokens: number;
}

export interface SetAsideLine {
  /** Numéro de ligne dans `entrainement.jsonl` (à partir de 1). */
  line: number;
  id: string | null;
  reason: string;
}

export interface PrepSummary {
  source: { examples: number; exercises: number };
  kept: number;
  train: number;
  validation: number;
  setAside: { total: number; byReason: Record<string, number> };
  levels: { kept: Record<LabLevel, number>; train: Record<LabLevel, number>; validation: Record<LabLevel, number> };
  tokens: { cap: number; min: number | null; max: number | null; mean: number | null; median: number | null };
  options: Required<PrepOptions>;
}

export type PrepResult =
  | { ok: true; train: PreparedExample[]; validation: PreparedExample[]; setAside: SetAsideLine[]; summary: PrepSummary }
  | { ok: false; reason: string; setAside: SetAsideLine[]; summary: PrepSummary };

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

type WriteCall = { path: string; content: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Appels de la réponse de l'assistant, tous `write_file` bien formés, ou la raison du refus.
 *
 * **Règle commune avec `training/jarvis_training/data.py`** (revue du 2026-11-02, point 3) : la
 * préparation Node écarte exactement ce que l'entraînement Python refuserait, avec la même raison.
 * Un seul appel qui n'est pas `write_file`, ou dont `path` / `content` ne sont pas des chaînes, ou
 * dont le contenu est vide, écarte tout l'exemple : rien n'est « réparé » dans une donnée.
 */
export function writeCallsOf(example: unknown): { ok: true; calls: WriteCall[] } | { ok: false; reason: string } {
  if (!isRecord(example) || !Array.isArray(example.messages)) return { ok: false, reason: 'ligne illisible' };
  const assistant = example.messages[2];
  if (!isRecord(assistant) || !Array.isArray(assistant.tool_calls) || assistant.tool_calls.length === 0) {
    return { ok: false, reason: 'sans appel write_file' };
  }
  const calls: WriteCall[] = [];
  for (const call of assistant.tool_calls) {
    if (!isRecord(call) || !isRecord(call.function)) return { ok: false, reason: 'appel d’outil non conforme : appel sans fonction' };
    if (call.function.name !== 'write_file') return { ok: false, reason: `appel d’outil non conforme : ${String(call.function.name)} au lieu de write_file` };
    const args = call.function.arguments;
    if (!isRecord(args) || typeof args.path !== 'string' || typeof args.content !== 'string') {
      return { ok: false, reason: 'appel d’outil non conforme : write_file attend path et content en chaînes' };
    }
    if (!args.content.trim()) return { ok: false, reason: 'appel d’outil non conforme : write_file au contenu vide' };
    calls.push({ path: args.path, content: args.content });
  }
  return { ok: true, calls };
}

export type ParsedExampleLine =
  | { ok: true; example: LabTrainingExample; calls: WriteCall[] }
  | { ok: false; reason: string; id: string | null };

export function parseExampleLine(line: string): ParsedExampleLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, reason: 'ligne illisible', id: null };
  }
  const id = isRecord(parsed) && typeof parsed.id === 'string' ? parsed.id : null;
  if (!isRecord(parsed) || id === null || !Array.isArray(parsed.messages) || !isRecord(parsed.meta)) {
    return { ok: false, reason: 'ligne illisible', id };
  }
  const roles = parsed.messages.map((message) => (isRecord(message) ? message.role : null));
  if (roles[0] !== 'system' || roles[1] !== 'user' || roles[2] !== 'assistant') return { ok: false, reason: 'ligne illisible', id };
  const user = parsed.messages[1] as Record<string, unknown>;
  if (typeof user.content !== 'string' || !user.content.trim()) return { ok: false, reason: 'ligne illisible', id };
  const calls = writeCallsOf(parsed);
  if (!calls.ok) return { ok: false, reason: calls.reason, id };
  if (!Array.isArray(parsed.tools) || parsed.tools.length === 0) return { ok: false, reason: 'sans catalogue tools', id };
  return { ok: true, example: parsed as unknown as LabTrainingExample, calls: calls.calls };
}

/** Niveau, thème et objectif de chaque exercice accepté, par identifiant de mission. */
export function readExerciseInfo(exerciseLines: readonly string[]): Map<string, ExerciseInfo> {
  const info = new Map<string, ExerciseInfo>();
  for (const line of exerciseLines) {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(row) || !isRecord(row.mission) || typeof row.mission.id !== 'string') continue;
    const level = row.mission.level;
    if (level !== 1 && level !== 2 && level !== 3) continue;
    const seed = isRecord(row.provenance) && isRecord(row.provenance.seed) ? row.provenance.seed : null;
    info.set(row.mission.id, {
      level,
      ...(typeof row.mission.category === 'string' ? { category: row.mission.category as LabCategory } : {}),
      ...(seed && typeof seed.theme === 'string' ? { theme: seed.theme } : {}),
      ...(typeof row.mission.goal === 'string' ? { goal: row.mission.goal } : {}),
    });
  }
  return info;
}

/* ------------------------------------------------------------------ */
/* Contrôles                                                           */
/* ------------------------------------------------------------------ */

/** Clé d'un doublon exact : la conversation entière (consigne, demande, fichiers écrits), pas les métadonnées. */
export function exactKey(example: LabTrainingExample): string {
  const [system, user, assistant] = example.messages;
  return JSON.stringify([
    system.content,
    user.content,
    assistant.content,
    assistant.tool_calls.map((call) => [call.function.name, call.function.arguments.path, call.function.arguments.content]),
  ]);
}

/** Longueur estimée de ce que le modèle voit : consigne, demande, réponse (appels compris) et catalogue d'outils. */
export function estimateTokens(example: LabTrainingExample): number {
  const [system, user, assistant] = example.messages;
  const text = [system.content, user.content, assistant.content, JSON.stringify(assistant.tool_calls), JSON.stringify(example.tools ?? [])].join('\n');
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Objectif d'un exemple : celui de l'exercice, sinon le premier paragraphe de la demande (`labFirstPrompt`). */
export function goalOf(example: LabTrainingExample, info: ExerciseInfo | undefined): string {
  if (info?.goal) return info.goal;
  const user = example.messages[1].content;
  return user.split(/\r?\n\r?\n/)[0]?.trim() ?? '';
}

let evalReference: { origins: { missionId: string; goal: string }[]; solutions: Map<string, string> } | null = null;
function examReference() {
  if (!evalReference) {
    const entries = evalCatalog();
    evalReference = {
      origins: entries.map((entry) => ({ missionId: entry.mission.id, goal: entry.mission.goal })),
      solutions: new Map(entries.flatMap((entry) => entry.solution.map((file) => [file.content.trim(), entry.mission.id] as const))),
    };
  }
  return evalReference;
}

/**
 * Règle 2 : un exemple suspect de reprendre une mission de l'examen est écarté. Trois contrôles,
 * tous déterministes : identifiant ou objectif proche (`labContamination`), nom exporté ou
 * objectif proche (`noveltyCheck` du générateur, sans exercice accepté), solution identique à
 * une solution de référence.
 */
export function examContamination(example: LabTrainingExample, calls: readonly WriteCall[], info: ExerciseInfo | undefined): string | null {
  const reference = examReference();
  const mission: LabMission = {
    id: example.meta.mission,
    level: info?.level ?? example.meta.level,
    category: info?.category ?? (example.meta.category as LabCategory),
    difficulty: info?.level ?? example.meta.level,
    split: 'development',
    goal: goalOf(example, info),
    constraints: [],
    passCriteria: [],
    starterFiles: calls.map((call): LabFile => ({ path: call.path, content: call.content })),
    hiddenTests: [],
  };
  const byOrigin = labContamination(mission, reference.origins);
  if (byOrigin) return byOrigin;
  for (const call of calls) {
    const evalId = reference.solutions.get(call.content.trim());
    if (evalId) return `solution identique à celle de l’évaluation (${evalId})`;
  }
  const novel = noveltyCheck(mission, []);
  return novel.ok ? null : novel.reason;
}

/* ------------------------------------------------------------------ */
/* Découpe                                                             */
/* ------------------------------------------------------------------ */

/** Générateur déterministe (mulberry32) : la découpe ne dépend que de la graine et du cahier. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nombre d'exemples de validation pour `count` exemples d'un niveau : la part arrondie, jamais tous. */
export function validationCount(count: number, share: number): number {
  if (count < 2) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(count * share)));
}

/**
 * Découpe train / validation répartie par niveau. L'ordre des lignes d'entrée ne compte pas :
 * les exemples sont triés par identifiant avant le mélange.
 */
export function splitByLevel<T extends { id: string; level: LabLevel }>(
  items: readonly T[],
  share: number,
  seed: number,
): { train: T[]; validation: T[] } {
  const train: T[] = [];
  const validation: T[] = [];
  for (const level of [1, 2, 3] as const) {
    const pool = items.filter((item) => item.level === level).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const random = seededRandom(seed + level);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
    }
    const held = validationCount(pool.length, share);
    validation.push(...pool.slice(0, held));
    train.push(...pool.slice(held));
  }
  return { train, validation };
}

/* ------------------------------------------------------------------ */
/* Préparation                                                         */
/* ------------------------------------------------------------------ */

function resolveOptions(options: PrepOptions | undefined): Required<PrepOptions> {
  return {
    maxTokens: options?.maxTokens ?? PREP_DEFAULTS.maxTokens,
    validationShare: options?.validationShare ?? PREP_DEFAULTS.validationShare,
    seed: options?.seed ?? PREP_DEFAULTS.seed,
    minKept: options?.minKept ?? PREP_DEFAULTS.minKept,
  };
}

function reasonFamily(reason: string): string {
  if (reason.startsWith('doublon exact')) return 'doublon exact';
  if (reason.startsWith('trop long')) return 'trop long';
  if (reason.startsWith('appel d’outil non conforme')) return 'appel d’outil non conforme';
  if (reason.startsWith('suspect de contamination')) return 'suspect de contamination de l’examen';
  return reason;
}

function levelCounts(items: readonly { level: LabLevel }[]): Record<LabLevel, number> {
  const counts: Record<LabLevel, number> = { 1: 0, 2: 0, 3: 0 };
  for (const item of items) counts[item.level] += 1;
  return counts;
}

function tokenStats(items: readonly { tokens: number }[], cap: number): PrepSummary['tokens'] {
  if (items.length === 0) return { cap, min: null, max: null, mean: null, median: null };
  const sorted = items.map((item) => item.tokens).sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
  return { cap, min: sorted[0]!, max: sorted[sorted.length - 1]!, mean: Math.round(sum / sorted.length), median };
}

export function refusalMessage(kept: number, minKept: number): string {
  return `Préparation refusée : ${kept} exemple(s) gardé(s), il en faut au moins ${minKept} : il faut encore des nuits de génération (npm run lab:generate --workspace @jarvis/core).`;
}

export function prepareTrainingData(input: {
  exampleLines: readonly string[];
  exerciseLines?: readonly string[];
  options?: PrepOptions;
}): PrepResult {
  const options = resolveOptions(input.options);
  const info = readExerciseInfo(input.exerciseLines ?? []);
  const kept: PreparedExample[] = [];
  const setAside: SetAsideLine[] = [];
  const seen = new Map<string, number>();
  input.exampleLines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) return;
    const parsed = parseExampleLine(line);
    if (!parsed.ok) {
      setAside.push({ line: lineNumber, id: parsed.id, reason: parsed.reason });
      return;
    }
    const { example, calls } = parsed;
    const key = exactKey(example);
    const first = seen.get(key);
    if (first !== undefined) {
      setAside.push({ line: lineNumber, id: example.id, reason: `doublon exact de la ligne ${first}` });
      return;
    }
    seen.set(key, lineNumber);
    const tokens = estimateTokens(example);
    if (tokens > options.maxTokens) {
      setAside.push({ line: lineNumber, id: example.id, reason: `trop long (${tokens} jetons estimés, plafond ${options.maxTokens})` });
      return;
    }
    const exercise = info.get(example.meta.mission);
    const contamination = examContamination(example, calls, exercise);
    if (contamination) {
      setAside.push({ line: lineNumber, id: example.id, reason: `suspect de contamination de l’examen : ${contamination}` });
      return;
    }
    const level = exercise?.level ?? example.meta.level;
    kept.push({ line, id: example.id, mission: example.meta.mission, level, theme: exercise?.theme ?? null, tokens });
  });

  const byReason: Record<string, number> = {};
  for (const item of setAside) byReason[reasonFamily(item.reason)] = (byReason[reasonFamily(item.reason)] ?? 0) + 1;
  const base = {
    source: { examples: input.exampleLines.filter((line) => line.trim()).length, exercises: info.size },
    kept: kept.length,
    setAside: { total: setAside.length, byReason },
    tokens: tokenStats(kept, options.maxTokens),
    options,
  };
  if (kept.length < options.minKept) {
    return {
      ok: false,
      reason: refusalMessage(kept.length, options.minKept),
      setAside,
      summary: { ...base, train: 0, validation: 0, levels: { kept: levelCounts(kept), train: { 1: 0, 2: 0, 3: 0 }, validation: { 1: 0, 2: 0, 3: 0 } } },
    };
  }
  const { train, validation } = splitByLevel(kept, options.validationShare, options.seed);
  return {
    ok: true,
    train,
    validation,
    setAside,
    summary: {
      ...base,
      train: train.length,
      validation: validation.length,
      levels: { kept: levelCounts(kept), train: levelCounts(train), validation: levelCounts(validation) },
    },
  };
}

/** Contenu des fichiers écrits par la préparation (le script les pose sur le disque). */
export function preparationFiles(result: PrepResult, now = new Date()): Record<string, string> {
  const jsonl = (lines: readonly string[]) => lines.map((line) => `${line}\n`).join('');
  const setAside = result.setAside.map((item) => JSON.stringify({ line: item.line, id: item.id, reason: item.reason }));
  const files: Record<string, string> = {
    'ecartes.jsonl': jsonl(setAside),
    'resume.json': `${JSON.stringify({ at: now.toISOString(), ok: result.ok, ...(result.ok ? {} : { reason: result.reason }), ...result.summary }, null, 2)}\n`,
  };
  if (result.ok) {
    files['train.jsonl'] = jsonl(result.train.map((item) => item.line));
    files['validation.jsonl'] = jsonl(result.validation.map((item) => item.line));
  }
  return files;
}
