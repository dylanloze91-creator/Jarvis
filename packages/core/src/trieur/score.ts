/** Une ligne du banc du trieur (`rapports/*trieur-banc*.json`). */
export interface MeasuredModel {
  model: string;
  correct: number;
  total: number;
}

export interface MeasuredBench {
  at?: string;
  exam?: string;
  models?: MeasuredModel[];
}

export interface RouterScoreLine {
  line: string;
  advice: string;
}

function percent(correct: number, total: number): number {
  return Math.round((100 * correct) / total);
}

/** Phrase affichée à côté du trieur. `null` si le banc ne compare pas trieur et cerveau. */
export function routerScoreFromBench(report: MeasuredBench): RouterScoreLine | null {
  const models = report.models ?? [];
  const trieur = models.find((model) => /trieur/i.test(model.model) && model.total > 0);
  const brain = models.find(
    (model) => /(?:^|:)7b\b/i.test(model.model) && !/trieur/i.test(model.model) && model.total > 0,
  );
  if (!trieur || !brain) return null;
  const trieurPct = percent(trieur.correct, trieur.total);
  const brainPct = percent(brain.correct, brain.total);
  const line = `Trieur : ${trieurPct} % de bonnes équipes sur tes phrases. Le cerveau : ${brainPct} %.`;
  const advice =
    trieurPct < brainPct
      ? 'Pour l’instant, garde le cerveau.'
      : 'Le trieur égale ou dépasse le cerveau sur ce banc. Rien n’est activé tout seul.';
  return { line, advice };
}

/**
 * Dernier score utile. Un fichier `trieur-dernier-score` gagne.
 * Sinon l'examen des phrases Jarvis (« tes phrases »), pas le banc synthétique plus récent.
 * Sinon le rapport le plus récent qui compare les deux.
 */
export function pickLatestRouterScore(
  reports: readonly (MeasuredBench & { name?: string })[],
): RouterScoreLine | null {
  const ranked = reports.flatMap((report) => {
    const score = routerScoreFromBench(report);
    if (!score) return [];
    return [
      {
        score,
        at: Date.parse(report.at ?? '') || 0,
        jarvis: report.exam === 'jarvis' || /jarvis/i.test(report.name ?? ''),
        pinned: /dernier-score/i.test(report.name ?? ''),
      },
    ];
  });
  const byTime = (left: { at: number }, right: { at: number }) => right.at - left.at;
  const pinned = ranked.filter((item) => item.pinned).sort(byTime);
  if (pinned[0]) return pinned[0].score;
  const jarvis = ranked.filter((item) => item.jarvis).sort(byTime);
  if (jarvis[0]) return jarvis[0].score;
  const rest = [...ranked].sort(byTime);
  return rest[0]?.score ?? null;
}
