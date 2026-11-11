/**
 * Nettoyage d'une transcription Whisper avant qu'elle ne parte au chat.
 *
 * Sur un son court ou abîmé (bip, phrase coupée), Whisper « tourne en boucle » : la même phrase répétée
 * jusqu'au plafond de jetons (« Qu'est-ce que c'est que ça ? » six fois, observé le 2026-11-11 depuis
 * l'enceinte). Une suite de phrases identiques est ramenée à une seule ; deux phrases différentes qui se
 * suivent restent telles quelles.
 */
const SENTENCE_SPLIT = /(?<=[.!?…])\s+/u;

function sentenceKey(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[\s.,;:!?…'’"«»-]+/gu, ' ')
    .trim();
}

export function collapseRepeatedSentences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(SENTENCE_SPLIT).filter((part) => part.trim());
  if (parts.length < 2) return trimmed;
  const kept: string[] = [];
  let previous: string | null = null;
  for (const part of parts) {
    const key = sentenceKey(part);
    if (key && key === previous) continue;
    kept.push(part.trim());
    previous = key;
  }
  return kept.join(' ');
}
