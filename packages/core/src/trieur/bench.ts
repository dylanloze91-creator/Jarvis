import type { OrchestraTeam } from '../agent/orchestraTeams.js';
import { ORCHESTRA_TEAMS } from '../agent/orchestraTeams.js';
import { parseRouterReply, routerSystemPrompt, routerUserPrompt } from '../agent/orchestra.js';
import type { ExamLine } from './extract.js';
import { availableTeams } from '../agent/orchestra.js';

export interface RouterModel {
  name: string;
  complete(input: {
    system: string;
    user: string;
    signal?: AbortSignal;
  }): Promise<{ text: string; loadMs?: number; phraseMs?: number; gpuFraction?: number | null }>;
}

export interface BenchRow {
  phrase: string;
  expected: OrchestraTeam | 'unknown' | 'not_a_request';
  predicted: OrchestraTeam | null;
  readable: boolean;
}

export interface BenchModelReport {
  model: string;
  skipped: string | null;
  total: number;
  correct: number;
  byTeam: Record<string, { total: number; correct: number }>;
  confusion: Record<string, Record<string, number>>;
  unreadable: number;
  loadMs: number | null;
  meanPhraseMs: number | null;
  gpuFraction: number | null;
}

export interface BenchReport {
  at: string;
  examLines: number;
  /** Phrases validées en direct comptées dans le banc (côté examen). */
  liveExamLines?: number;
  models: BenchModelReport[];
  /** Scores séparés quand `valide.jsonl` est lu. */
  liveModels?: BenchModelReport[];
}

const ROUTER_MAX_TOKENS = 12;
const ROUTER_TEMPERATURE = 0;

/**
 * Outils fictifs : toutes les équipes du chef d'orchestre sont « disponibles » pour le banc.
 * Un nom par équipe à outils, qui satisfait ses motifs (`spotify_*`, `generer_image`…).
 * Jusqu'à la 5.0.75, `play_spotify` ne correspondait pas à `spotify_*` et `generer_image` manquait :
 * Musique et Images n'étaient jamais proposées au modèle, leurs phrases étaient perdues d'avance.
 */
export const BENCH_TOOLS = [
  'get_system_info',
  'search_files',
  'web_search',
  'spotify_play',
  'siteblock_set_blocking',
  'search_jarvis_memory',
  'google_gmail_list',
  'write_file',
  'generer_image',
  'lancer_routine',
];
const ALL_TOOLS = BENCH_TOOLS;

export function filterExamForBench(lines: readonly ExamLine[]): ExamLine[] {
  return lines.filter((line) => ORCHESTRA_TEAMS.includes(line.team as OrchestraTeam));
}

export async function benchModel(model: RouterModel, exam: readonly ExamLine[], signal?: AbortSignal): Promise<BenchModelReport> {
  const teams = availableTeams(ALL_TOOLS);
  const system = routerSystemPrompt(teams);
  const rows: BenchRow[] = [];
  let loadMs: number | null = null;
  const phraseTimes: number[] = [];
  let gpuFraction: number | null = null;

  for (const line of exam) {
    if (!ORCHESTRA_TEAMS.includes(line.team as OrchestraTeam)) continue;
    const userPrompt = line.context.trim() ? line.context : routerUserPrompt(line.phrase, []);
    const result = await model.complete({ system, user: userPrompt, signal });
    if (loadMs === null && result.loadMs != null) loadMs = result.loadMs;
    if (result.phraseMs != null) phraseTimes.push(result.phraseMs);
    if (result.gpuFraction != null) gpuFraction = result.gpuFraction;
    const predicted = parseRouterReply(result.text, teams);
    rows.push({
      phrase: line.phrase,
      expected: line.team,
      predicted,
      readable: predicted !== null,
    });
  }

  const byTeam: BenchModelReport['byTeam'] = {};
  const confusion: BenchModelReport['confusion'] = {};
  let correct = 0;
  let unreadable = 0;
  for (const row of rows) {
    const expected = row.expected as string;
    byTeam[expected] ??= { total: 0, correct: 0 };
    byTeam[expected].total += 1;
    if (!row.readable) unreadable += 1;
    else if (row.predicted === row.expected) {
      correct += 1;
      byTeam[expected].correct += 1;
    }
    const pred = row.predicted ?? '(illisible)';
    confusion[expected] ??= {};
    confusion[expected][pred] = (confusion[expected][pred] ?? 0) + 1;
  }

  return {
    model: model.name,
    skipped: null,
    total: rows.length,
    correct,
    byTeam,
    confusion,
    unreadable,
    loadMs,
    meanPhraseMs: phraseTimes.length ? phraseTimes.reduce((a, b) => a + b, 0) / phraseTimes.length : null,
    gpuFraction,
  };
}

export function benchSummaryText(report: BenchReport): string {
  const lines = [`Examen du trieur · ${report.examLines} phrase(s) triées à froid`];
  if (report.liveExamLines != null) {
    lines[0] += ` · ${report.liveExamLines} validée(s) en direct`;
  }
  lines[0] += ` · ${report.at}`;
  for (const model of report.models) {
    lines.push(formatModelLine('trié à froid', model));
  }
  if (report.liveModels?.length) {
    for (const model of report.liveModels) {
      lines.push(formatModelLine('validé en direct', model));
    }
  }
  return lines.join('\n');
}

function formatModelLine(kind: string, model: BenchModelReport): string {
  if (model.skipped) {
    return `- ${kind} · ${model.model} : absent (${model.skipped})`;
  }
  const pct = model.total ? Math.round((100 * model.correct) / model.total) : 0;
  return (
    `- ${kind} · ${model.model} : ${model.correct}/${model.total} (${pct} %) · illisibles ${model.unreadable}` +
    (model.loadMs != null ? ` · chargement ${Math.round(model.loadMs)} ms` : '') +
    (model.meanPhraseMs != null ? ` · ${Math.round(model.meanPhraseMs)} ms/phrase` : '') +
    (model.gpuFraction != null ? ` · carte ~${Math.round(model.gpuFraction * 100)} %` : '')
  );
}

export { ROUTER_MAX_TOKENS, ROUTER_TEMPERATURE };
