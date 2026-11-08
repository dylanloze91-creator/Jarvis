/**
 * « Jarvis, est-ce que tout va bien ? », « fais ton bilan » : règle express, sans modèle.
 * Le texte doit être la demande entière (pas une phrase au milieu d'un paragraphe).
 */
const HEALTH_INTENT =
  /^(?:jarvis[, ]+)?(?:est-ce que tout va bien|fais (?:ton |le )?bilan(?: de sant[eé])?|bilan de sant[eé])\s*[?!.]*$/iu;

export function looksLikeHealthIntent(text: string): boolean {
  return HEALTH_INTENT.test(text.trim());
}
