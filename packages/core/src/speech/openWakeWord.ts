import { attenuateClipping } from './voiceGain.js';

/** Trame attendue par les modèles officiels openWakeWord (80 ms à 16 kHz). */
export const OPENWAKEWORD_FRAME_SIZE = 1280;
export const OPENWAKEWORD_SAMPLE_RATE = 16000;

/**
 * Le mel ONNX officiel consomme du PCM 16 bits (entiers castés en float),
 * pas des flottants Web Audio dans [-1, 1]. Sans ce facteur le score reste
 * à 0 sur de la parole réelle. Voir openWakeWord `AudioFeatures`.
 */
export const OPENWAKEWORD_INT16_SCALE = 32767;

/** Message court pour la barre vocale : « indisponible » + chiffres = ERROR_CODE ORT. */
export function describeOpenWakeWordLoadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = raw.match(/ERROR_CODE:\s*(\d+)/i)?.[1];
  if (code) return `code ${code}`;
  if (/failed to fetch/i.test(raw) || /\b404\b/.test(raw) || /not found/i.test(raw)) {
    return 'fichiers du modèle introuvables';
  }
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
}

/**
 * Sensibilité 0–1 → seuil de score openWakeWord. 0.7 (défaut) ≈ 0.34.
 * Le modèle officiel est entraîné sur « hey jarvis » : un « Jarvis » nu
 * score plus bas, d'où un seuil plus permissif que 0.59. Plus c'est
 * sensible, plus le seuil descend (1.0 → 0.25).
 */
export function openWakeWordSensitivityToThreshold(sensitivity: number): number {
  const clamped = Math.max(0, Math.min(1, sensitivity));
  return 0.55 - clamped * 0.3;
}

/**
 * PCM prêt pour le mel : même signal que le niveau crête, atténué si la
 * crête atteint le plein échelle, puis porté à l'échelle 16 bits. La
 * longueur ne change pas (le 16 kHz est fait avant, par `resampleLinear`).
 */
export function scaleOpenWakeWordPcm(pcm: Float32Array): Float32Array {
  const leveled = attenuateClipping(pcm).pcm;
  const out = new Float32Array(leveled.length);
  for (let index = 0; index < leveled.length; index += 1) {
    const value = leveled[index]! * OPENWAKEWORD_INT16_SCALE;
    out[index] = Math.max(-32768, Math.min(32767, value));
  }
  return out;
}

/** Rééchantillonnage linéaire — le micro Electron vise 16 kHz, mais le contexte peut diverger. */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let index = 0; index < outLength; index += 1) {
    const source = index * ratio;
    const lower = Math.min(input.length - 1, Math.floor(source));
    const upper = Math.min(input.length - 1, lower + 1);
    const fraction = source - lower;
    out[index] = (input[lower] ?? 0) * (1 - fraction) + (input[upper] ?? 0) * fraction;
  }
  return out;
}

/** Accumule le PCM et le découpe en trames de taille fixe (reste conservé). */
export function takeFixedFrames(
  remainder: Float32Array,
  incoming: Float32Array,
  frameSize: number,
): { chunks: Float32Array[]; remainder: Float32Array } {
  const combined = new Float32Array(remainder.length + incoming.length);
  combined.set(remainder);
  combined.set(incoming, remainder.length);
  const chunks: Float32Array[] = [];
  let offset = 0;
  while (offset + frameSize <= combined.length) {
    chunks.push(combined.slice(offset, offset + frameSize));
    offset += frameSize;
  }
  return { chunks, remainder: combined.slice(offset) };
}
