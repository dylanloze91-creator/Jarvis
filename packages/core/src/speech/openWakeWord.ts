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
 * Sensibilité 0–1 → seuil de score openWakeWord. 0,7 (défaut) → 0,5, le
 * seuil conseillé par openWakeWord ; 1 → 0,35 ; 0 → 0,85. Avec le mel
 * corrigé (contexte de 480 échantillons), du bruit blanc atteignait 0,34 :
 * l'ancien seuil par défaut. « Jarvis » seul est l'affaire de Vosk.
 */
export function openWakeWordSensitivityToThreshold(sensitivity: number): number {
  const clamped = Math.max(0, Math.min(1, sensitivity));
  return 0.85 - clamped * 0.5;
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

/** Échantillons du pas précédent redonnés au mel (3 pas de 160) : sans eux, 5 trames mel par 80 ms au lieu de 8. */
export const OPENWAKEWORD_MEL_CONTEXT = 480;
export const OPENWAKEWORD_MEL_BINS = 32;
/** Trames mel vues par le modèle d'embedding (0,76 s). */
export const OPENWAKEWORD_MEL_WINDOW = 76;
/** Même plafond que `AudioFeatures` (10 s de trames mel). */
const OPENWAKEWORD_MEL_BUFFER_MAX = 970;

/**
 * Flux de caractéristiques d'openWakeWord, calqué sur `AudioFeatures`
 * (Python) : chaque trame de 1280 échantillons est passée au mel avec les
 * 480 échantillons qui la précèdent, ce qui donne 8 trames mel (pas de
 * 10 ms) ; un embedding est calculé à chaque trame sur les 76 dernières
 * trames mel, le tampon démarrant rempli de 1. Sans le contexte, le mel
 * ne rend que 5 trames par 80 ms : l'échelle de temps est faussée et le
 * score s'effondre (0,012 au lieu de 0,207 sur la prise GoXLR).
 */
export class OpenWakeWordMelStream {
  private raw = new Float32Array(0);
  private frames: Float32Array[] = OpenWakeWordMelStream.initialFrames();

  private static initialFrames(): Float32Array[] {
    return Array.from({ length: OPENWAKEWORD_MEL_WINDOW }, () =>
      new Float32Array(OPENWAKEWORD_MEL_BINS).fill(1),
    );
  }

  /** Entrée du modèle mel pour cette trame : contexte précédent + trame. */
  melInput(chunk: Float32Array): Float32Array {
    const joined = new Float32Array(this.raw.length + chunk.length);
    joined.set(this.raw);
    joined.set(chunk, this.raw.length);
    this.raw = joined.slice(Math.max(0, joined.length - chunk.length - OPENWAKEWORD_MEL_CONTEXT));
    return this.raw;
  }

  /** Sortie brute du mel (n × 32) ; la transformation `x / 10 + 2` d'openWakeWord est appliquée ici. */
  pushMel(rawMel: Float32Array): number {
    const count = Math.floor(rawMel.length / OPENWAKEWORD_MEL_BINS);
    for (let index = 0; index < count; index += 1) {
      const frame = new Float32Array(OPENWAKEWORD_MEL_BINS);
      for (let bin = 0; bin < OPENWAKEWORD_MEL_BINS; bin += 1) {
        frame[bin] = rawMel[index * OPENWAKEWORD_MEL_BINS + bin]! / 10 + 2;
      }
      this.frames.push(frame);
    }
    if (this.frames.length > OPENWAKEWORD_MEL_BUFFER_MAX) {
      this.frames = this.frames.slice(-OPENWAKEWORD_MEL_BUFFER_MAX);
    }
    return count;
  }

  /** Les 76 dernières trames mel, à plat, pour l'embedding. */
  embeddingWindow(): Float32Array {
    const window = this.frames.slice(-OPENWAKEWORD_MEL_WINDOW);
    const flat = new Float32Array(OPENWAKEWORD_MEL_WINDOW * OPENWAKEWORD_MEL_BINS);
    window.forEach((frame, index) => flat.set(frame, index * OPENWAKEWORD_MEL_BINS));
    return flat;
  }

  reset(): void {
    this.raw = new Float32Array(0);
    this.frames = OpenWakeWordMelStream.initialFrames();
  }
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
