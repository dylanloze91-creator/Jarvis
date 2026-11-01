/**
 * Examen et décision (5.0.65) : compare deux modèles sur le rapport JSON du banc du laboratoire
 * (`scripts/lab-bench.mjs`, jeu `eval`, 29 missions) et rend un verdict simple en français.
 * Pur : pas de modèle, pas de disque. Le script `lab-compare.mjs` lance le banc et écrit le rapport.
 *
 * Règle de décision (cahier des charges) : le candidat n'est conseillé que s'il dépasse la base
 * sur le total **et** ne perd pas plus de `COMPARE_RULE.maxLost` missions qu'elle réussissait.
 * « Réussissait » = réussie à la majorité des passages (2 sur 3 avec trois passages).
 */

/** Forme du rapport écrit par `lab-bench.mjs` (seuls les champs lus ici). */
export interface BenchMissionRow {
  id: string;
  level?: number;
  passed: boolean;
  excluded?: boolean;
}

export interface BenchRun {
  run: number;
  missions: BenchMissionRow[];
}

export interface BenchModelResult {
  model: string;
  label?: string;
  skipped?: string | null;
  runs: BenchRun[];
}

export interface BenchReport {
  at?: string;
  results: BenchModelResult[];
}

export const COMPARE_RULE = {
  /** Missions que la base réussissait et que le candidat peut perdre sans être déconseillé. */
  maxLost: 2,
} as const;

export type Verdict = 'meilleur' | 'pareil' | 'moins bon';

export interface MissionComparison {
  id: string;
  level: number | null;
  /** Passages réussis sur le nombre de passages comptés. */
  base: number;
  candidate: number;
  runs: number;
  baseSucceeded: boolean;
  candidateSucceeded: boolean;
  change: 'gagnée' | 'perdue' | 'stable';
}

export interface ModelScore {
  model: string;
  /** Total des missions réussies sur tous les passages (par exemple 66 sur 87). */
  passed: number;
  total: number;
  perRun: number[];
  /** Missions réussies à la majorité des passages. */
  succeeded: number;
}

export interface Comparison {
  base: ModelScore;
  candidate: ModelScore;
  missions: MissionComparison[];
  won: string[];
  lost: string[];
  verdict: Verdict;
  /** `true` seulement si la règle du cahier des charges est satisfaite. */
  advised: boolean;
  reason: string;
}

function findModel(report: BenchReport, name: string): BenchModelResult {
  const wanted = name.includes(':') ? name : `${name}:latest`;
  const found = report.results.find((result) => result.model === name || result.model === wanted);
  if (!found) throw new Error(`le modèle ${name} n’est pas dans le rapport du banc`);
  if (found.skipped) throw new Error(`le modèle ${name} a été sauté par le banc : ${found.skipped}`);
  if (found.runs.length === 0) throw new Error(`le modèle ${name} n’a aucun passage dans le rapport`);
  return found;
}

/** Par mission : passages comptés et réussis (une mission écartée d'un passage n'y compte pas). */
function tally(result: BenchModelResult): Map<string, { level: number | null; runs: number; passed: number }> {
  const table = new Map<string, { level: number | null; runs: number; passed: number }>();
  for (const run of result.runs) {
    for (const mission of run.missions) {
      if (mission.excluded) continue;
      const entry = table.get(mission.id) ?? { level: mission.level ?? null, runs: 0, passed: 0 };
      entry.runs += 1;
      if (mission.passed) entry.passed += 1;
      table.set(mission.id, entry);
    }
  }
  return table;
}

function scoreOf(result: BenchModelResult, succeeded: number): ModelScore {
  const perRun = result.runs.map((run) => run.missions.filter((mission) => !mission.excluded && mission.passed).length);
  const total = result.runs.reduce((sum, run) => sum + run.missions.filter((mission) => !mission.excluded).length, 0);
  return { model: result.model, passed: perRun.reduce((sum, value) => sum + value, 0), total, perRun, succeeded };
}

export function majority(passed: number, runs: number): boolean {
  return runs > 0 && passed * 2 > runs;
}

export function compareBench(report: BenchReport, baseName: string, candidateName: string): Comparison {
  if (baseName === candidateName) throw new Error('la base et le candidat doivent être deux modèles différents');
  const base = findModel(report, baseName);
  const candidate = findModel(report, candidateName);
  const baseTable = tally(base);
  const candidateTable = tally(candidate);
  const ids = [...new Set([...baseTable.keys(), ...candidateTable.keys()])].sort();
  const missions: MissionComparison[] = ids.map((id) => {
    const b = baseTable.get(id) ?? { level: null, runs: 0, passed: 0 };
    const c = candidateTable.get(id) ?? { level: null, runs: 0, passed: 0 };
    const baseSucceeded = majority(b.passed, b.runs);
    const candidateSucceeded = majority(c.passed, c.runs);
    return {
      id,
      level: b.level ?? c.level,
      base: b.passed,
      candidate: c.passed,
      runs: Math.max(b.runs, c.runs),
      baseSucceeded,
      candidateSucceeded,
      change: baseSucceeded === candidateSucceeded ? 'stable' : candidateSucceeded ? 'gagnée' : 'perdue',
    };
  });
  const won = missions.filter((mission) => mission.change === 'gagnée').map((mission) => mission.id);
  const lost = missions.filter((mission) => mission.change === 'perdue').map((mission) => mission.id);
  const baseScore = scoreOf(base, missions.filter((mission) => mission.baseSucceeded).length);
  const candidateScore = scoreOf(candidate, missions.filter((mission) => mission.candidateSucceeded).length);
  const verdict: Verdict =
    candidateScore.passed > baseScore.passed ? 'meilleur' : candidateScore.passed === baseScore.passed ? 'pareil' : 'moins bon';
  const advised = verdict === 'meilleur' && lost.length <= COMPARE_RULE.maxLost;
  const totals = `${candidateScore.model} ${candidateScore.passed}/${candidateScore.total} contre ${baseScore.model} ${baseScore.passed}/${baseScore.total}`;
  const reason = advised
    ? `${totals} : le candidat dépasse la base sur le total et perd ${lost.length} mission(s) qu’elle réussissait (${COMPARE_RULE.maxLost} au plus) → conseillé.`
    : verdict === 'meilleur'
      ? `${totals} : total meilleur, mais ${lost.length} mission(s) perdue(s) que la base réussissait (${lost.join(', ')}), plus que ${COMPARE_RULE.maxLost} → non conseillé.`
      : verdict === 'pareil'
        ? `${totals} : même total → non conseillé (garder la base, rien ne change).`
        : `${totals} : le candidat fait moins bien → non conseillé (garder la base).`;
  return { base: baseScore, candidate: candidateScore, missions, won, lost, verdict, advised, reason };
}

function pad(text: string | number, width: number): string {
  const value = String(text);
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/** Tableau Markdown mission par mission, puis totaux et verdict. */
export function comparisonMarkdown(comparison: Comparison, at = new Date()): string {
  const { base, candidate } = comparison;
  const lines = [
    `# Examen : ${candidate.model} contre ${base.model}`,
    '',
    `Date : ${at.toISOString().slice(0, 10)}. Jeu d'évaluation du laboratoire, ${base.perRun.length} passage(s) par modèle.`,
    '',
    `| Mission | Niveau | ${base.model} | ${candidate.model} | Évolution |`,
    '| --- | --- | --- | --- | --- |',
    ...comparison.missions.map(
      (mission) =>
        `| ${mission.id} | ${mission.level ?? '—'} | ${mission.base}/${mission.runs} | ${mission.candidate}/${mission.runs} | ${mission.change} |`,
    ),
    '',
    `**Total** : ${base.model} ${base.passed}/${base.total} (par passage ${base.perRun.join(', ')}) · ${candidate.model} ${candidate.passed}/${candidate.total} (par passage ${candidate.perRun.join(', ')}).`,
    '',
    `Missions réussies à la majorité des passages : ${base.model} ${base.succeeded}, ${candidate.model} ${candidate.succeeded}. Gagnées : ${comparison.won.length ? comparison.won.join(', ') : 'aucune'}. Perdues : ${comparison.lost.length ? comparison.lost.join(', ') : 'aucune'}.`,
    '',
    `## Verdict : ${comparison.verdict}${comparison.advised ? ' (conseillé)' : ' (non conseillé)'}`,
    '',
    comparison.reason,
    '',
    `Règle : le candidat n'est conseillé que s'il dépasse la base sur le total et ne perd pas plus de ${COMPARE_RULE.maxLost} missions qu'elle réussissait. Le choix final reste à l'utilisateur.`,
    '',
  ];
  return lines.join('\n');
}

/** Résumé pour la console. */
export function comparisonText(comparison: Comparison): string {
  const { base, candidate } = comparison;
  const width = Math.max(10, ...comparison.missions.map((mission) => mission.id.length));
  const lines = [
    `${pad('Mission', width)}  ${pad(base.model, Math.max(8, base.model.length))}  ${pad(candidate.model, Math.max(8, candidate.model.length))}  Évolution`,
    ...comparison.missions.map(
      (mission) =>
        `${pad(mission.id, width)}  ${pad(`${mission.base}/${mission.runs}`, Math.max(8, base.model.length))}  ${pad(`${mission.candidate}/${mission.runs}`, Math.max(8, candidate.model.length))}  ${mission.change}`,
    ),
    '',
    `Total : ${base.model} ${base.passed}/${base.total} · ${candidate.model} ${candidate.passed}/${candidate.total}`,
    `Verdict : ${comparison.verdict}${comparison.advised ? ' — conseillé' : ' — non conseillé'}`,
    comparison.reason,
  ];
  return lines.join('\n');
}

/** Rapport JSON : chiffres seulement, sans énoncé, sans fichier ni chemin. */
export function comparisonReport(comparison: Comparison, at = new Date()): Record<string, unknown> {
  return {
    at: at.toISOString(),
    set: 'eval',
    rule: COMPARE_RULE,
    base: comparison.base,
    candidate: comparison.candidate,
    missions: comparison.missions,
    won: comparison.won,
    lost: comparison.lost,
    verdict: comparison.verdict,
    advised: comparison.advised,
    reason: comparison.reason,
  };
}
