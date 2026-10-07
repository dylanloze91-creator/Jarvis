import { peakEnergy } from './wakeWordFromTranscript.js';

/** Plein échelle des flottants Web Audio. Au-delà, le signal est déjà écrêté. */
export const FULL_SCALE_PEAK = 1;

/**
 * Crête visée après atténuation. Sous 1 pour ne pas rendre à Whisper, ni
 * à l'échelle 16 bits d'openWakeWord, des échantillons collés à ±1.
 */
export const ATTENUATED_PEAK = 0.89;

/** Crête visée pour la dictée quand le micro est trop faible (GoXLR, casque). */
export const DICTATION_TARGET_PEAK = 0.28;
/** En dessous, on ne amplifie pas (bruit de fond). */
export const DICTATION_MIN_PEAK_TO_BOOST = 0.02;
/** Plafond de gain pour éviter de saturer le bruit. */
export const DICTATION_MAX_GAIN = 12;

export interface AttenuatedPcm {
  pcm: Float32Array;
  /** Crête brute, avant gain. */
  peak: number;
  applied: boolean;
}

/** Même forme d'onde que le niveau crête, ramenée sous le plein échelle si besoin. */
export function attenuateClipping(pcm: Float32Array): AttenuatedPcm {
  const peak = peakEnergy(pcm);
  if (pcm.length === 0 || !(peak >= FULL_SCALE_PEAK)) {
    return { pcm, peak, applied: false };
  }
  const gain = ATTENUATED_PEAK / peak;
  const out = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index += 1) out[index] = pcm[index]! * gain;
  return { pcm: out, peak, applied: true };
}

/** Ramène un signal faible à une crête exploitable par Whisper, sans toucher au mot de réveil. */
export function normalizeDictationLevel(pcm: Float32Array): Float32Array {
  const peak = peakEnergy(pcm);
  if (pcm.length === 0 || peak < DICTATION_MIN_PEAK_TO_BOOST || peak >= DICTATION_TARGET_PEAK) return pcm;
  const gain = Math.min(DICTATION_MAX_GAIN, DICTATION_TARGET_PEAK / peak);
  const out = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index += 1) out[index] = pcm[index]! * gain;
  return out;
}
