/**
 * Proximité entre une phrase d'entraînement et l'examen du trieur.
 * Même principe que `exerciseSimilarity` (mots ≥ 4 lettres, stop list réduite).
 * Seuil documenté : 0,40 (calqué sur DUPLICATE_SIMILARITY.alone du générateur d'exercices).
 */
const STOP = new Set([
  'avec',
  'dans',
  'pour',
  'cette',
  'comme',
  'mais',
  'plus',
  'tout',
  'tous',
  'toute',
  'jarvis',
  'demande',
  'equipe',
  'conversation',
  'utilisateur',
]);

function tokens(text: string): Set<string> {
  return new Set(
    (text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .match(/[a-z]{4,}/g) ?? []
    ).filter((word) => !STOP.has(word)),
  );
}

export function trieurTextSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Seuil au-dessus duquel un exemple généré est trop proche de l'examen (règle 2 du cahier). */
export const EXAM_CONTAMINATION_THRESHOLD = 0.4;

export function examContamination(phrase: string, context: string, exam: readonly { phrase: string; context: string }[]): string | null {
  const left = `${phrase}\n${context}`;
  for (const row of exam) {
    const sim = trieurTextSimilarity(left, `${row.phrase}\n${row.context}`);
    if (sim >= EXAM_CONTAMINATION_THRESHOLD) return `trop proche de l'examen (${sim.toFixed(2)})`;
  }
  return null;
}
