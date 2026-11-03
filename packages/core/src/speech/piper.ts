/**
 * 5.0.67 — synthèse locale Piper (ONNX, voix françaises). Logique pure : pas de
 * binaire Piper ici, seulement contrats, découpage et fusion WAV.
 */
import { decodeWav, encodeWav } from './wav.js';

export const PIPER_TTS_ID = 'local-piper';

/** Fréquence des WAV fenêtre / iPhone ; l'enceinte est rééchantillonnée à 16 kHz ailleurs. */
export const PIPER_SAMPLE_RATE = 22_050;

/** Phrase d'exemple pour « Écouter » dans les réglages. */
export const PIPER_PREVIEW_TEXT =
  'Bonjour, je suis Jarvis. Voici un aperçu de ma voix locale, gratuite et sans Internet.';

export interface PiperVoiceDefinition {
  /** Valeur enregistrée dans `settings.voice.ttsVoice`. */
  id: string;
  label: string;
  /** Fichier `.onnx` dans `voice-assets/piper/models/`. */
  modelFile: string;
  /** Indice locuteur Piper (`--speaker`), 0 par défaut. */
  speaker: number;
}

/** Trois voix françaises libres pour redistribution (cartes MODEL_CARD vérifiées le 2026-11-02). */
export const PIPER_VOICES: readonly PiperVoiceDefinition[] = [
  { id: 'fr_FR-siwis-medium', label: 'Siwis (féminin, naturel)', modelFile: 'fr_FR-siwis-medium.onnx', speaker: 0 },
  { id: 'fr_FR-upmc-jessica', label: 'UPMC Jessica (féminin)', modelFile: 'fr_FR-upmc-medium.onnx', speaker: 0 },
  { id: 'fr_FR-upmc-pierre', label: 'UPMC Pierre (masculin)', modelFile: 'fr_FR-upmc-medium.onnx', speaker: 1 },
];

export const DEFAULT_PIPER_VOICE_ID = PIPER_VOICES[0]!.id;

export function describePiperVoice(voiceId: string | undefined): PiperVoiceDefinition {
  const match = PIPER_VOICES.find((voice) => voice.id === voiceId);
  return match ?? PIPER_VOICES[0]!;
}

/**
 * Découpe le texte en phrases pour lire la première pendant que les suivantes
 * se synthétisent. Les blocs vides sont retirés ; un texte sans ponctuation
 * reste un seul bloc.
 */
export function splitFrenchSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const parts = normalized.split(/(?<=[.!?…])\s+/u);
  const sentences = parts.map((part) => part.trim()).filter(Boolean);
  return sentences.length > 0 ? sentences : [normalized];
}

/** Seuil : au-delà, on lit phrase par phrase si la synthèse est lente. */
export const PIPER_STREAM_CHAR_THRESHOLD = 120;

/** Durée mesurée pour ~200 caractères au-delà de laquelle on active le mode phrase. */
export const PIPER_STREAM_LATENCY_MS = 1_000;

export const PIPER_BENCHMARK_SAMPLE_CHARS = 200;

export function shouldStreamPiperSpeech(text: string, benchmarkMs: number | null): boolean {
  const trimmed = text.trim();
  if (trimmed.length >= PIPER_STREAM_CHAR_THRESHOLD) return true;
  if (benchmarkMs !== null && benchmarkMs > PIPER_STREAM_LATENCY_MS && trimmed.length >= 40) return true;
  return splitFrenchSentences(trimmed).length > 1 && trimmed.length >= 60;
}

/** Concatène plusieurs WAV mono PCM 16 bits (même fréquence ou rééchantillonnage linéaire simple). */
export function concatWavClips(clips: Uint8Array[]): Uint8Array {
  if (clips.length === 0) throw new Error('Aucun clip audio à fusionner.');
  if (clips.length === 1) return clips[0]!;
  const decoded = clips.map((clip) => decodeWav(clip));
  const sampleRate = decoded[0]!.sampleRate;
  const samples: Float32Array[] = [];
  for (const clip of decoded) {
    if (clip.sampleRate === sampleRate) {
      samples.push(clip.samples);
      continue;
    }
    samples.push(resampleLinear(clip.samples, clip.sampleRate, sampleRate));
  }
  const merged = mergeSamples(samples);
  return encodeWav(merged, sampleRate);
}

function mergeSamples(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const outLength = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const src = (i * fromRate) / toRate;
    const left = Math.floor(src);
    const right = Math.min(samples.length - 1, left + 1);
    const frac = src - left;
    out[i] = samples[left]! * (1 - frac) + samples[right]! * frac;
  }
  return out;
}
