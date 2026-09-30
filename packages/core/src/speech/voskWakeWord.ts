/**
 * « Jarvis » seul, repéré par Vosk (Kaldi, modèle français) avec une
 * grammaire fermée. Pur : le modèle tourne côté renderer (vosk-browser,
 * Web Worker) ; ici on décide seulement ce qui compte comme un réveil.
 *
 * Mesures sur les prises de thedexios (9 fichiers, dont la prise GoXLR) et
 * 17 négatifs (phrases françaises avec « Gervais », « Javel », « j'avais »,
 * « parvis »…, commande seule, bruit blanc, sinus) : avec les leurres
 * ci-dessous et une confiance ≥ 0,9, 9 prises sur 9 et 0 faux réveil. Sans
 * leurres, 4 faux réveils sur les mêmes négatifs.
 */
import { normalizeForWakeWordMatch } from './wakeWordTextMatch.js';

/** Mots proches de « Jarvis » : ils absorbent ce qui n'est pas le prénom. */
export const VOSK_JARVIS_DECOYS = ['gervais', 'javel', "j'avais", 'avis', 'parvis', 'jardin', 'service'] as const;

export interface VoskWord {
  word: string;
  conf: number;
  /** Secondes depuis le début du flux donné au recognizer. */
  start: number;
  end: number;
}

/** Grammaire JSON du recognizer : le mot de réveil, ses leurres, et `[unk]` pour tout le reste. */
export function voskGrammar(wakeWord: string): string[] {
  const word = normalizeForWakeWordMatch(wakeWord) || 'jarvis';
  if (word === 'jarvis') return ['jarvis', ...VOSK_JARVIS_DECOYS, '[unk]'];
  return [word, '[unk]'];
}

/** Sensibilité 0–1 → confiance minimale du mot. 0,7 (défaut) → 0,90. */
export function voskMinConfidence(sensitivity: number): number {
  const clamped = Math.max(0, Math.min(1, sensitivity));
  return Math.max(0.85, Math.min(0.97, 0.97 - 0.1 * clamped));
}

/** Occurrences du mot de réveil dans un résultat final de Vosk (`setWords(true)`). */
export function voskWakeHits(result: unknown, wakeWord: string, minConfidence: number): VoskWord[] {
  const words = (result as { result?: unknown } | null)?.result;
  if (!Array.isArray(words)) return [];
  const target = normalizeForWakeWordMatch(wakeWord) || 'jarvis';
  return words
    .filter(
      (entry): entry is VoskWord =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as VoskWord).word === 'string' &&
        typeof (entry as VoskWord).conf === 'number' &&
        typeof (entry as VoskWord).start === 'number' &&
        typeof (entry as VoskWord).end === 'number',
    )
    .filter((entry) => normalizeForWakeWordMatch(entry.word) === target && entry.conf >= minConfidence);
}

/**
 * Fenêtre à transmettre à la dictée : depuis un peu avant le mot de réveil
 * jusqu'à maintenant. `commandOffset` = fin du mot, dans cette fenêtre.
 */
export function voskWakeWindow(
  hit: VoskWord,
  totalSamples: number,
  sampleRate: number,
  leadSeconds = 0.25,
): { startSample: number; commandOffset: number } {
  const startSample = Math.max(0, Math.min(totalSamples, Math.round((hit.start - leadSeconds) * sampleRate)));
  const endSample = Math.max(startSample, Math.min(totalSamples, Math.round(hit.end * sampleRate)));
  return { startSample, commandOffset: endSample - startSample };
}
