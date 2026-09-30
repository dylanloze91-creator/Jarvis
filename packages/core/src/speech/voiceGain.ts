import { peakEnergy } from './wakeWordFromTranscript.js';

/** Plein échelle des flottants Web Audio. Au-delà, le signal est déjà écrêté. */
export const FULL_SCALE_PEAK = 1;

/**
 * Crête visée après atténuation. Sous 1 pour ne pas rendre à Whisper, ni
 * à l'échelle 16 bits d'openWakeWord, des échantillons collés à ±1.
 */
export const ATTENUATED_PEAK = 0.89;

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
