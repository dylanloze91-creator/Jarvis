/**
 * Banc de vitesse : comparer deux passages (avant / après un outil).
 *
 * Un passage est une liste de journaux de tour, un par demande type. Les demandes types sont
 * écrites par Claude Code pour le banc : ce ne sont pas des phrases de l'utilisateur, et elles
 * ne passent jamais par ses conversations.
 */
import type { TurnLogEntry } from '../types.js';
import { LOAD_PAID_MS, formatMs, median, stepMs, summarizeSpeed, type SpeedStep } from './resume.js';

export interface BenchTurn extends TurnLogEntry {
  /** Identifiant de la demande type (`a1`, `d2`…). */
  demande: string;
  /** `ok`, `erreur` (le tour a rendu une erreur) ou `delai` (arrêté au plafond). */
  statut: 'ok' | 'erreur' | 'delai';
}

export interface BenchRun {
  label: string;
  date: string;
  commit?: string;
  /** Modèles chargés dans Ollama à la fin du passage : nom et part sur la carte graphique. */
  loaded?: { name: string; sizeMb: number; vramMb: number }[];
  /** Préchauffage fait avant la première demande, en millisecondes (absent : aucun). */
  warmupMs?: number;
  turns: BenchTurn[];
}

const COMPARED: { step: SpeedStep; label: string }[] = [
  { step: 'total', label: 'tour entier' },
  { step: 'premierMot', label: 'premier mot' },
  { step: 'tri', label: 'tri' },
  { step: 'chargement', label: 'chargement du modèle' },
  { step: 'lecture', label: 'lecture du prompt' },
  { step: 'ecriture', label: 'écriture' },
  { step: 'outils', label: 'outils' },
];

function values(turns: readonly BenchTurn[], step: SpeedStep): number[] {
  const out: number[] = [];
  for (const turn of turns) {
    const value = stepMs(turn, step);
    if (value !== null) out.push(value);
  }
  return out;
}

function gap(before: number, after: number): string {
  const delta = after - before;
  if (Math.abs(delta) < 1) return '=';
  const sign = delta < 0 ? '−' : '+';
  const share = before > 0 ? ` (${sign}${Math.round((Math.abs(delta) / before) * 100)} %)` : '';
  return `${sign}${formatMs(Math.abs(delta))}${share}`;
}

function loadsPaid(turns: readonly BenchTurn[]): number {
  return turns.filter(
    (turn) => (turn.etapes?.chargement ?? 0) > LOAD_PAID_MS || (turn.etapes?.tri?.chargementMs ?? 0) > LOAD_PAID_MS,
  ).length;
}

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, value) => total + value, 0);
}

/** Tableau « avant / après » d'un outil, en Markdown. Que des chiffres. */
export function compareBenchRuns(before: BenchRun, after: BenchRun): string {
  const ids = before.turns.map((turn) => turn.demande).filter((id) => after.turns.some((turn) => turn.demande === id));
  const a = before.turns.filter((turn) => ids.includes(turn.demande));
  const b = after.turns.filter((turn) => ids.includes(turn.demande));
  const lines: string[] = [
    `### ${before.label} → ${after.label}`,
    '',
    `${ids.length} demandes comparées. Médiane / pire cas.`,
    '',
    `| étape | ${before.label} | ${after.label} | écart de médiane | écart du total |`,
    '| --- | --- | --- | --- | --- |',
  ];
  for (const { step, label } of COMPARED) {
    const va = values(a, step);
    const vb = values(b, step);
    if (va.length === 0 && vb.length === 0) continue;
    const cell = (list: number[]): string => (list.length ? `${formatMs(median(list))} / ${formatMs(Math.max(...list))}` : '—');
    lines.push(
      `| ${label} | ${cell(va)} | ${cell(vb)} | ${va.length && vb.length ? gap(median(va), median(vb)) : '—'} | ${va.length && vb.length ? gap(sum(va), sum(vb)) : '—'} |`,
    );
  }
  const tokens = (turns: readonly BenchTurn[]): number[] => turns.flatMap((turn) => (turn.etapes?.lecture ? [turn.etapes.lecture.jetons] : []));
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length && tb.length) {
    lines.push(`| jetons lus par tour | ${median(ta)} / ${Math.max(...ta)} | ${median(tb)} / ${Math.max(...tb)} | ${median(tb) - median(ta)} | ${sum(tb) - sum(ta)} |`);
  }
  lines.push(
    '',
    `Tours qui paient un chargement de plus d’une seconde : ${loadsPaid(a)} → ${loadsPaid(b)}.`,
    `Tours en erreur ou arrêtés au plafond : ${a.filter((turn) => turn.statut !== 'ok').length} → ${b.filter((turn) => turn.statut !== 'ok').length}.`,
  );
  if (before.warmupMs !== undefined || after.warmupMs !== undefined) {
    const text = (ms: number | undefined): string => (ms === undefined ? 'aucun' : formatMs(ms));
    lines.push(`Préchauffage avant la première demande : ${text(before.warmupMs)} → ${text(after.warmupMs)}.`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Détail d'un passage, demande par demande. */
export function benchRunTable(run: BenchRun): string {
  const lines = [
    `### Passage « ${run.label} »`,
    '',
    '| demande | équipe | chemin | modèle | tour | premier mot | tri | chargement | lecture (jetons) | écriture (jetons) | outils | état |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const ms = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : formatMs(value));
  for (const turn of run.turns) {
    const steps = turn.etapes;
    const tools = steps?.outils?.length
      ? steps.outils.map((tool) => `${tool.name} ${formatMs(tool.ms)}${tool.garde ? ' (gardé)' : ''}`).join(', ')
      : '—';
    lines.push(
      `| ${turn.demande} | ${turn.team ?? '—'} | ${steps?.tri?.chemin ?? turn.how ?? '—'} | ${turn.model ?? '—'} | ${formatMs(turn.durationMs)} | ${ms(steps?.premierMot)} | ${ms(steps?.tri?.ms)}${steps?.tri?.chargementMs && steps.tri.chargementMs > LOAD_PAID_MS ? ` (dont ${formatMs(steps.tri.chargementMs)} de chargement)` : ''} | ${ms(steps?.chargement)} | ${steps?.lecture ? `${formatMs(steps.lecture.ms)} (${steps.lecture.jetons})` : '—'} | ${steps?.ecriture ? `${formatMs(steps.ecriture.ms)} (${steps.ecriture.jetons})` : '—'} | ${tools} | ${turn.statut} |`,
    );
  }
  const summary = summarizeSpeed(run.turns);
  lines.push('', `Tour entier : médiane ${formatMs(summary.all.steps.total?.medianMs ?? 0)}, pire ${formatMs(summary.all.steps.total?.worstMs ?? 0)}.`, '');
  return lines.join('\n');
}

/** Lit un passage enregistré. Rend `null` si le fichier n'a pas la forme attendue. */
export function parseBenchRun(raw: unknown): BenchRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const run = raw as Partial<BenchRun>;
  if (typeof run.label !== 'string' || !Array.isArray(run.turns)) return null;
  const turns = run.turns.filter(
    (turn): turn is BenchTurn =>
      !!turn && typeof turn === 'object' && typeof turn.demande === 'string' && typeof turn.durationMs === 'number',
  );
  return { ...run, label: run.label, date: typeof run.date === 'string' ? run.date : '', turns } as BenchRun;
}
