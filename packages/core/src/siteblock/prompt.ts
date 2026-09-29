/**
 * Consigne ajoutée au prompt système : les demandes de blocage passent
 * par les outils `siteblock_*`, jamais par une affirmation gratuite.
 */
export const SITEBLOCK_SYSTEM_PROMPT_FRAGMENT = [
  'Si l’utilisateur demande de bloquer ou débloquer des sites, d’activer un mode travail ou concentration, ou de programmer un créneau de blocage, utilise les outils siteblock_*.',
  'Ne prétends jamais avoir modifié le blocage sans un résultat positif de l’outil.',
  'SiteBlock doit tourner sur ce PC ; Jarvis ne touche pas lui-même au fichier hosts.',
].join(' ');

export function withSiteBlockPrompt(systemPrompt: string): string {
  if (/siteblock_/i.test(systemPrompt)) return systemPrompt;
  return `${systemPrompt} ${SITEBLOCK_SYSTEM_PROMPT_FRAGMENT}`.trim();
}
