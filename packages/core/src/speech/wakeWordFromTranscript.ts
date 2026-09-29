import { matchesWakeWord, type WakeWordTextMatchConfig } from './wakeWordTextMatch.js';

/**
 * Cœur, testable indépendamment de tout modèle réel, du mot de réveil « par
 * transcription » : Whisper tourne en continu sur de courtes fenêtres
 * audio, et on cherche le mot de réveil dans le texte produit. Ce module ne
 * fait qu'orchestrer la décision — la fenêtre audio brute mérite-t-elle
 * d'être transcrite, et le texte obtenu contient-il le mot de réveil — sans
 * jamais appeler Whisper lui-même : `transcribe` est injecté par
 * l'appelant (le vrai moteur côté renderer, ou un simulateur dans les
 * tests). C'est ce qui permet de tester cette logique sans DOM, sans
 * modèle téléchargé et sans micro.
 *
 * La garde d'énergie est le point clé du coût processeur : Whisper est cher
 * à faire tourner (même le plus petit modèle), donc on ne le sollicite que
 * sur les fenêtres qui contiennent vraisemblablement de la parole. Une
 * pièce silencieuse ne doit jamais déclencher de transcription.
 */
export interface WakeWordTranscriptionGateOptions {
  /** Amplitude de crête minimale dans la fenêtre pour la juger candidate. */
  minPeakEnergy: number;
}

export const defaultWakeWordTranscriptionGateOptions: WakeWordTranscriptionGateOptions = {
  minPeakEnergy: 0.01,
};

export interface WakeWordTranscriptionResult {
  /** Faux si la fenêtre a été ignorée faute d'énergie suffisante : aucune transcription n'a été lancée. */
  analyzed: boolean;
  /** Texte produit par `transcribe`, ou `null` si la fenêtre n'a pas été analysée. */
  transcript: string | null;
  /** Vrai si `transcript` contient le mot de réveil (voir `matchesWakeWord`). */
  matched: boolean;
}

export type TranscribeWindow = (frame: Float32Array, sampleRate: number) => Promise<string>;

/** Amplitude absolue maximale d'une trame — réactive et bon marché, contrairement au RMS lissé dans le temps. */
export function peakEnergy(frame: Float32Array): number {
  let peak = 0;
  for (const sample of frame) {
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Durée (ms) de parole dans `pcm` : fenêtres de 64 ms dont le RMS dépasse
 * `rmsThreshold`. Sert à distinguer une vraie commande de la fin du mot de
 * réveil ou d'un souffle, qu'un simple pic laisse passer.
 */
export function speechDurationMs(pcm: Float32Array, sampleRate: number, rmsThreshold = 0.02): number {
  const window = Math.max(1, Math.round(sampleRate * 0.064));
  let speechWindows = 0;
  for (let start = 0; start + window <= pcm.length; start += window) {
    let sum = 0;
    for (let index = start; index < start + window; index += 1) sum += pcm[index]! * pcm[index]!;
    if (Math.sqrt(sum / window) >= rmsThreshold) speechWindows += 1;
  }
  return (speechWindows * window * 1000) / sampleRate;
}

/**
 * Applique la garde d'énergie, puis, si elle passe, transcrit la fenêtre et
 * compare le résultat au mot de réveil. Ne lance jamais deux transcriptions
 * en parallèle par elle-même : c'est à l'appelant (le moteur avec état, qui
 * connaît le débit des trames) de sérialiser les appels — cette fonction
 * reste, elle, une simple fonction pure côté logique de décision.
 */
export async function evaluateWakeWordWindow(
  frame: Float32Array,
  sampleRate: number,
  transcribe: TranscribeWindow,
  matchConfig: WakeWordTextMatchConfig,
  gateOptions: Partial<WakeWordTranscriptionGateOptions> = {},
): Promise<WakeWordTranscriptionResult> {
  const options = { ...defaultWakeWordTranscriptionGateOptions, ...gateOptions };
  if (peakEnergy(frame) < options.minPeakEnergy) {
    return { analyzed: false, transcript: null, matched: false };
  }

  const transcript = await transcribe(frame, sampleRate);
  return { analyzed: true, transcript, matched: matchesWakeWord(transcript, matchConfig) };
}
