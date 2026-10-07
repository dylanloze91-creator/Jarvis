/**
 * Corrections ciblées après Whisper sur la dictée française : erreurs
 * observées sur des commandes réelles (voir docs transcription-vocale).
 * N’affecte pas le mot de réveil ni l’anglais de confirmation.
 */
export function refineFrenchDictation(text: string): string {
  let current = text.trim();
  if (!current) return current;
  current = current
    .replace(/\bouf\s*,?\s*cr[oô]me\b/giu, 'ouvre Chrome')
    .replace(/\bouf\s*,?\s*chrome\b/giu, 'ouvre Chrome')
    .replace(/\bouv\s*,?\s*chrome\b/giu, 'ouvre Chrome')
    .replace(/\bouf\s+allure\b/giu, 'ouvre Chrome')
    .replace(/\bouvre\s+chrome\b/giu, 'ouvre Chrome');
  return current.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}
