/**
 * Caractéristiques d'un extrait de réveil pour le vérificateur personnel :
 * les embeddings openWakeWord (96 valeurs par pas de 80 ms) de l'extrait,
 * résumés en moyenne, maximum et écart-type. Les modèles ONNX restent côté
 * appelant (renderer, ou script de mesure) : ici, seulement le calcul.
 */
import type { WakeWordWindow } from '../wakewordEngine.js';
import {
  OPENWAKEWORD_FRAME_SIZE,
  OPENWAKEWORD_MEL_BINS,
  OPENWAKEWORD_MEL_WINDOW,
  OPENWAKEWORD_SAMPLE_RATE,
  OpenWakeWordMelStream,
  resampleLinear,
  scaleOpenWakeWordPcm,
} from '../openWakeWord.js';
import { attenuateClipping } from '../voiceGain.js';

export const WAKE_EMBEDDING_SIZE = 96;
/** Durée fixe d'un extrait : « Jarvis » et un peu de contexte. */
export const WAKE_CLIP_SECONDS = 2;
export const WAKE_CLIP_SAMPLES = WAKE_CLIP_SECONDS * OPENWAKEWORD_SAMPLE_RATE;
/** Audio gardé après la fin du mot (fin de l'attaque du mot suivant exclue). */
const CLIP_TAIL_SECONDS = 0.15;
/** Pas d'embedding dont la fenêtre mel contient encore le remplissage initial. */
const WARMUP_STEPS = Math.ceil(OPENWAKEWORD_MEL_WINDOW / 8);
/** moyenne + maximum + écart-type. */
export const WAKE_FEATURE_SIZE = WAKE_EMBEDDING_SIZE * 3;

/**
 * Extrait fixe de 2 s à 16 kHz qui se termine juste après le mot de réveil.
 * Vosk donne la fin du mot (`commandOffset`) ; openWakeWord se déclenche à
 * la fin du mot, donc la fin de la fenêtre. Complété par du silence devant.
 */
export function wakeClipFromWindow(window: WakeWordWindow): Float32Array {
  const pcm =
    window.sampleRate === OPENWAKEWORD_SAMPLE_RATE
      ? window.pcm
      : resampleLinear(window.pcm, window.sampleRate, OPENWAKEWORD_SAMPLE_RATE);
  const ratio = OPENWAKEWORD_SAMPLE_RATE / window.sampleRate;
  const wordEnd =
    window.commandOffset !== undefined
      ? Math.min(pcm.length, Math.round(window.commandOffset * ratio + CLIP_TAIL_SECONDS * OPENWAKEWORD_SAMPLE_RATE))
      : pcm.length;
  return fixedClip(pcm.subarray(0, wordEnd));
}

/** Les `WAKE_CLIP_SAMPLES` derniers échantillons, précédés de silence si l'audio est plus court. */
export function fixedClip(pcm: Float32Array): Float32Array {
  const clip = new Float32Array(WAKE_CLIP_SAMPLES);
  const take = pcm.subarray(Math.max(0, pcm.length - WAKE_CLIP_SAMPLES));
  clip.set(take, WAKE_CLIP_SAMPLES - take.length);
  return clip;
}

export interface WakeEmbeddingRunner {
  /** Modèle `melspectrogram.onnx` : PCM à l'échelle 16 bits → mel brut (32 valeurs par trame). */
  mel: (pcm: Float32Array) => Promise<Float32Array>;
  /** Modèle `embedding_model.onnx` : fenêtre 76 × 32 → 96 valeurs. */
  embedding: (window: Float32Array) => Promise<Float32Array>;
}

/** Embeddings openWakeWord d'un extrait (même flux que le moteur : 480 échantillons de contexte, 8 trames par pas). */
export async function wakeClipEmbeddings(clip: Float32Array, runner: WakeEmbeddingRunner): Promise<Float32Array[]> {
  const stream = new OpenWakeWordMelStream();
  const scaled = scaleOpenWakeWordPcm(attenuateClipping(clip).pcm);
  const embeddings: Float32Array[] = [];
  let step = 0;
  for (let offset = 0; offset + OPENWAKEWORD_FRAME_SIZE <= scaled.length; offset += OPENWAKEWORD_FRAME_SIZE) {
    const chunk = scaled.subarray(offset, offset + OPENWAKEWORD_FRAME_SIZE);
    stream.pushMel(await runner.mel(stream.melInput(chunk)));
    step += 1;
    if (step < WARMUP_STEPS) continue;
    const window = stream.embeddingWindow();
    if (window.length !== OPENWAKEWORD_MEL_WINDOW * OPENWAKEWORD_MEL_BINS) continue;
    embeddings.push(new Float32Array(await runner.embedding(window)));
  }
  return embeddings;
}

/** Résumé fixe d'une suite d'embeddings : moyenne, maximum, écart-type par dimension. */
export function poolWakeEmbeddings(embeddings: Float32Array[]): number[] {
  const features = new Array<number>(WAKE_FEATURE_SIZE).fill(0);
  if (embeddings.length === 0) return features;
  for (let dim = 0; dim < WAKE_EMBEDDING_SIZE; dim += 1) {
    let sum = 0;
    let max = Number.NEGATIVE_INFINITY;
    for (const embedding of embeddings) {
      const value = embedding[dim] ?? 0;
      sum += value;
      if (value > max) max = value;
    }
    const mean = sum / embeddings.length;
    let variance = 0;
    for (const embedding of embeddings) variance += ((embedding[dim] ?? 0) - mean) ** 2;
    features[dim] = mean;
    features[WAKE_EMBEDDING_SIZE + dim] = max;
    features[2 * WAKE_EMBEDDING_SIZE + dim] = Math.sqrt(variance / embeddings.length);
  }
  return features;
}

export async function wakeClipFeatures(clip: Float32Array, runner: WakeEmbeddingRunner): Promise<number[]> {
  return poolWakeEmbeddings(await wakeClipEmbeddings(clip, runner));
}
