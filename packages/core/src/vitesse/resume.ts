/**
 * Résumé chiffré des journaux de tour (`vitesse.md`).
 *
 * Entrée : des journaux de tour. Sortie : des médianes, des pires cas et des parts de temps.
 * Aucune phrase n'est lue ni écrite : un journal de tour n'en contient pas, et ce module ne
 * reçoit jamais les messages.
 */
import type { TurnLogEntry, TurnSteps } from '../types.js';

export const SPEED_STEPS = ['tri', 'chargement', 'lecture', 'ecriture', 'outils', 'premierMot', 'voix', 'total'] as const;
export type SpeedStep = (typeof SPEED_STEPS)[number];

const STEP_LABELS: Record<SpeedStep, string> = {
  tri: 'tri (choix de l’équipe)',
  chargement: 'chargement du modèle',
  lecture: 'lecture du prompt',
  ecriture: 'écriture de la réponse',
  outils: 'outils',
  premierMot: 'premier mot',
  voix: 'premier son',
  total: 'tour entier',
};

/** Au-delà, le tour a payé un chargement de modèle. */
export const LOAD_PAID_MS = 1000;

export interface StepStat {
  n: number;
  medianMs: number;
  worstMs: number;
  sumMs: number;
}

export interface SpeedGroup {
  name: string;
  turns: number;
  /** Tours qui portent le détail des étapes. */
  timed: number;
  steps: Partial<Record<SpeedStep, StepStat>>;
  /** Part du temps total des tours chronométrés, de 0 à 1. Les étapes qui se suivent seulement. */
  shares: Partial<Record<SpeedStep, number>>;
  /** Jetons lus par tour (médiane, pire). */
  promptTokens: { n: number; median: number; worst: number } | null;
  /** Tours qui ont payé un chargement de plus d'une seconde (tri ou réponse). */
  loadsPaid: number;
}

export interface SpeedToolStat {
  name: string;
  calls: number;
  kept: number;
  medianMs: number;
  worstMs: number;
}

export interface SpeedSummary {
  turns: number;
  timed: number;
  all: SpeedGroup;
  byTeam: SpeedGroup[];
  byPath: SpeedGroup[];
  bySource: SpeedGroup[];
  byModel: SpeedGroup[];
  tools: SpeedToolStat[];
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function stat(values: readonly number[]): StepStat | undefined {
  if (values.length === 0) return undefined;
  return {
    n: values.length,
    medianMs: median(values),
    worstMs: Math.max(...values),
    sumMs: values.reduce((sum, value) => sum + value, 0),
  };
}

/** Durée d'une étape dans un tour, ou `null` si elle n'a pas été mesurée. */
export function stepMs(entry: Pick<TurnLogEntry, 'durationMs' | 'etapes'>, step: SpeedStep): number | null {
  if (step === 'total') return entry.durationMs;
  const steps: TurnSteps | undefined = entry.etapes;
  if (!steps) return null;
  switch (step) {
    case 'tri':
      return steps.tri ? steps.tri.ms : null;
    case 'chargement':
      return steps.chargement ?? null;
    case 'lecture':
      return steps.lecture ? steps.lecture.ms : null;
    case 'ecriture':
      return steps.ecriture ? steps.ecriture.ms : null;
    case 'outils':
      return steps.outils ? steps.outils.reduce((sum, tool) => sum + tool.ms, 0) : null;
    case 'premierMot':
      return steps.premierMot ?? null;
    case 'voix':
      return steps.voix ?? null;
  }
}

/** Étapes qui se suivent dans un tour : leur somme ne dépasse pas le tour entier. */
const SEQUENTIAL: SpeedStep[] = ['tri', 'chargement', 'lecture', 'ecriture', 'outils'];

function group(name: string, entries: readonly TurnLogEntry[]): SpeedGroup {
  const timed = entries.filter((entry) => entry.etapes);
  const steps: SpeedGroup['steps'] = {};
  for (const step of SPEED_STEPS) {
    const source = step === 'total' ? entries : timed;
    const values: number[] = [];
    for (const entry of source) {
      const value = stepMs(entry, step);
      if (value !== null) values.push(value);
    }
    const computed = stat(values);
    if (computed) steps[step] = computed;
  }
  const totalTimed = timed.reduce((sum, entry) => sum + entry.durationMs, 0);
  const shares: SpeedGroup['shares'] = {};
  if (totalTimed > 0) {
    for (const step of SEQUENTIAL) {
      const computed = steps[step];
      if (computed) shares[step] = Math.min(1, computed.sumMs / totalTimed);
    }
  }
  const tokens = timed.flatMap((entry) => (entry.etapes?.lecture ? [entry.etapes.lecture.jetons] : []));
  const loadsPaid = timed.filter(
    (entry) =>
      (entry.etapes?.chargement ?? 0) > LOAD_PAID_MS || (entry.etapes?.tri?.chargementMs ?? 0) > LOAD_PAID_MS,
  ).length;
  return {
    name,
    turns: entries.length,
    timed: timed.length,
    steps,
    shares,
    promptTokens: tokens.length ? { n: tokens.length, median: median(tokens), worst: Math.max(...tokens) } : null,
    loadsPaid,
  };
}

function groupsBy(entries: readonly TurnLogEntry[], key: (entry: TurnLogEntry) => string): SpeedGroup[] {
  const buckets = new Map<string, TurnLogEntry[]>();
  for (const entry of entries) {
    const name = key(entry);
    const bucket = buckets.get(name);
    if (bucket) bucket.push(entry);
    else buckets.set(name, [entry]);
  }
  return [...buckets.entries()]
    .map(([name, bucket]) => group(name, bucket))
    .sort((a, b) => b.turns - a.turns || a.name.localeCompare(b.name));
}

export function summarizeSpeed(entries: readonly TurnLogEntry[]): SpeedSummary {
  const tools = new Map<string, { ms: number[]; kept: number }>();
  for (const entry of entries) {
    for (const tool of entry.etapes?.outils ?? []) {
      const bucket = tools.get(tool.name) ?? { ms: [], kept: 0 };
      bucket.ms.push(tool.ms);
      if (tool.garde) bucket.kept += 1;
      tools.set(tool.name, bucket);
    }
  }
  return {
    turns: entries.length,
    timed: entries.filter((entry) => entry.etapes).length,
    all: group('tous les tours', entries),
    byTeam: groupsBy(entries, (entry) => entry.team ?? 'chat sans équipe'),
    byPath: groupsBy(entries, (entry) => entry.etapes?.tri?.chemin ?? entry.how ?? 'sans tri'),
    bySource: groupsBy(entries, (entry) => entry.source),
    byModel: groupsBy(entries, (entry) => (entry.model ? `${entry.model}${entry.place ? ` (${entry.place})` : ''}` : 'sans modèle')),
    tools: [...tools.entries()]
      .map(([name, bucket]) => ({
        name,
        calls: bucket.ms.length,
        kept: bucket.kept,
        medianMs: median(bucket.ms),
        worstMs: Math.max(...bucket.ms),
      }))
      .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
  };
}

/** « 1,2 s », « 340 ms », « 12 s ». */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return `${(seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)).replace('.', ',')} s`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)} %`;
}

function cell(computed: StepStat | undefined): string {
  return computed ? `${formatMs(computed.medianMs)} / ${formatMs(computed.worstMs)}` : '—';
}

const TABLE_STEPS: SpeedStep[] = ['total', 'premierMot', 'tri', 'chargement', 'lecture', 'ecriture', 'outils', 'voix'];

function table(title: string, groups: readonly SpeedGroup[]): string[] {
  if (groups.length === 0) return [];
  const lines = [
    `## ${title}`,
    '',
    'Médiane / pire cas.',
    '',
    `| | tours | ${TABLE_STEPS.map((step) => STEP_LABELS[step]).join(' | ')} | jetons lus | chargements payés |`,
    `| --- | --- | ${TABLE_STEPS.map(() => '---').join(' | ')} | --- | --- |`,
  ];
  for (const item of groups) {
    const tokens = item.promptTokens ? `${item.promptTokens.median} / ${item.promptTokens.worst}` : '—';
    lines.push(
      `| ${item.name} | ${item.turns} | ${TABLE_STEPS.map((step) => cell(item.steps[step])).join(' | ')} | ${tokens} | ${item.loadsPaid} |`,
    );
  }
  lines.push('');
  return lines;
}

export interface SpeedReportOptions {
  /** Date du rapport, déjà mise en forme. */
  date: string;
  /** Lignes d'en-tête : d'où viennent les journaux (jamais un chemin personnel). */
  sources?: string[];
}

/** Le fichier `vitesse.md` : des chiffres seulement. */
export function speedReport(summary: SpeedSummary, options: SpeedReportOptions): string {
  const lines: string[] = [
    '# Vitesse de Jarvis',
    '',
    `Fait le ${options.date}. Ce fichier ne contient que des chiffres : durées, nombres de tours, noms d’équipe, de modèle et d’outil. Aucune phrase.`,
    '',
    ...(options.sources?.length ? [...options.sources.map((line) => `- ${line}`), ''] : []),
    `Tours lus : ${summary.turns}. Tours avec le détail des étapes : ${summary.timed}.`,
    '',
  ];
  if (summary.turns === 0) {
    lines.push('Aucun tour dans le journal. Utilise Jarvis Test quelques jours, puis relance ce script.', '');
    return lines.join('\n');
  }
  if (summary.timed === 0) {
    lines.push(
      'Aucun tour ne porte encore le détail des étapes : ils ont été écrits avant le chronomètre. Seule la durée du tour entier est connue.',
      '',
    );
  } else {
    lines.push('## Où part le temps', '', 'Part du temps des tours chronométrés.', '');
    for (const step of SEQUENTIAL) {
      const share = summary.all.shares[step];
      if (share !== undefined) lines.push(`- ${STEP_LABELS[step]} : ${percent(share)}`);
    }
    const known = SEQUENTIAL.reduce((sum, step) => sum + (summary.all.shares[step] ?? 0), 0);
    lines.push(`- le reste (préparation, mémoire, enregistrement) : ${percent(Math.max(0, 1 - known))}`, '');
    lines.push(
      `Tours qui ont payé un chargement de modèle de plus d’une seconde : ${summary.all.loadsPaid} sur ${summary.timed}.`,
      '',
    );
  }
  lines.push(...table('Tous les tours', [summary.all]));
  lines.push(...table('Par équipe', summary.byTeam));
  lines.push(...table('Par chemin', summary.byPath));
  lines.push(...table('Par source', summary.bySource));
  lines.push(...table('Par modèle', summary.byModel));
  if (summary.tools.length) {
    lines.push('## Outils', '', '| outil | appels | repris de la mémoire courte | médiane | pire cas |', '| --- | --- | --- | --- | --- |');
    for (const tool of summary.tools) {
      lines.push(`| ${tool.name} | ${tool.calls} | ${tool.kept} | ${formatMs(tool.medianMs)} | ${formatMs(tool.worstMs)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Lit les journaux de tour d'un fichier de conversation déjà décodé. Tout ce qui n'a pas la
 * forme d'un journal est ignoré ; les messages ne sont jamais lus.
 */
export function turnLogsOf(conversation: unknown): TurnLogEntry[] {
  if (!conversation || typeof conversation !== 'object') return [];
  const log = (conversation as { turnLog?: unknown }).turnLog;
  if (!Array.isArray(log)) return [];
  const out: TurnLogEntry[] = [];
  for (const raw of log) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<TurnLogEntry>;
    if (typeof entry.durationMs !== 'number' || !Number.isFinite(entry.durationMs)) continue;
    if (typeof entry.source !== 'string') continue;
    out.push(entry as TurnLogEntry);
  }
  return out;
}
