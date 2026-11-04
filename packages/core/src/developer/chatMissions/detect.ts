/** Question ou extrait pédagogique : réponse écrite, pas proposer_mission. */
const CODE_QUESTION =
  /^(?:c['’]est quoi|qu['’]est[- ]ce que|explique|définis|define|what is|how does)\b/iu;

export function looksLikeCodeExplanationOnly(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (CODE_QUESTION.test(t)) return true;
  if (/^\s*montre[- ]moi un exemple\b/iu.test(t) && !/\b(crée|créer|fais|ajoute|corrige)\b/iu.test(t)) {
    return true;
  }
  return false;
}
