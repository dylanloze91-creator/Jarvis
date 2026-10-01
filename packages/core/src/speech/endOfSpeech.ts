/**
 * Fin de la commande après un réveil, mesurée en durée d'audio (jamais à
 * l'horloge : après une inférence, les trames retenues arrivent d'un coup).
 *
 * - Avant que la commande commence : on attend jusqu'à 1,5 s de silence
 *   (« Jarvis… [pause] quelle heure est-il ? »).
 * - Une fois la commande commencée : 650 ms de silence suffisent (0.4.16 :
 *   900 ms quoi qu'il arrive, ~1 s mesurée).
 * - La commande déjà dite dans la fenêtre du réveil (Vosk réveille à la fin
 *   de l'énoncé) compte : son silence de fin aussi.
 */

export const END_OF_SPEECH_RMS = 0.012;
export const SILENCE_AFTER_COMMAND_MS = 650;
export const SILENCE_BEFORE_COMMAND_MS = 1500;
/** Parole minimale (après le mot de réveil) pour considérer que la commande a commencé. */
export const COMMAND_STARTED_SPEECH_MS = 150;

const ANALYSIS_WINDOW_S = 0.016;
const WAKE_WORD_TAIL_S = 0.15;

function rms(pcm: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += pcm[index]! * pcm[index]!;
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

export class EndOfSpeechDetector {
  private speechMs = 0;
  private silenceMs = 0;

  constructor(
    private readonly afterCommandMs = SILENCE_AFTER_COMMAND_MS,
    private readonly beforeCommandMs = SILENCE_BEFORE_COMMAND_MS,
    private readonly threshold = END_OF_SPEECH_RMS,
  ) {}

  get commandStarted(): boolean {
    return this.speechMs >= COMMAND_STARTED_SPEECH_MS;
  }

  /** Audio de la commande déjà capté avec le mot de réveil (après `commandOffset`). */
  primeWithCommandAudio(pcm: Float32Array, sampleRate: number): void {
    const window = Math.max(1, Math.round(sampleRate * ANALYSIS_WINDOW_S));
    // La fin du mot de réveil déborde souvent de `commandOffset` : elle n'est pas la commande.
    const skip = Math.round(sampleRate * WAKE_WORD_TAIL_S);
    for (let start = Math.min(skip, pcm.length); start < pcm.length; start += window) {
      const end = Math.min(pcm.length, start + window);
      this.account(rms(pcm, start, end), ((end - start) / sampleRate) * 1000);
    }
  }

  /** Trame du micro analysée par fenêtres de 16 ms (les trames font jusqu'à 256 ms). Vrai quand la commande est finie. */
  pushPcm(frame: Float32Array, sampleRate: number): boolean {
    const window = Math.max(1, Math.round(sampleRate * ANALYSIS_WINDOW_S));
    for (let start = 0; start < frame.length; start += window) {
      const end = Math.min(frame.length, start + window);
      if (this.push(rms(frame, start, end), ((end - start) / sampleRate) * 1000)) return true;
    }
    return false;
  }

  /** Vrai quand la commande est finie. */
  push(frameRms: number, durationMs: number): boolean {
    this.account(frameRms, durationMs);
    return this.silenceMs >= (this.commandStarted ? this.afterCommandMs : this.beforeCommandMs);
  }

  private account(level: number, durationMs: number): void {
    if (level >= this.threshold) {
      this.speechMs += durationMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += durationMs;
    }
  }
}

/** Silence de fin que Whisper voyait en 0.4.16 (coupure à ~1 s) : il transcrit mieux avec. */
export const WHISPER_TRAILING_SILENCE_MS = 1_000;

/**
 * Prolonge le silence de fin jusqu'à `targetMs` en répétant le silence déjà
 * capté (le bruit de la pièce, pas des zéros) : la fin de parole est
 * détectée plus tôt sans changer ce que Whisper entend.
 */
export function extendTrailingSilence(
  pcm: Float32Array,
  sampleRate: number,
  targetMs = WHISPER_TRAILING_SILENCE_MS,
  threshold = END_OF_SPEECH_RMS,
): Float32Array {
  const window = Math.max(1, Math.round(sampleRate * ANALYSIS_WINDOW_S));
  let silentStart = pcm.length;
  while (silentStart - window >= 0 && rms(pcm, silentStart - window, silentStart) < threshold) silentStart -= window;
  const silent = pcm.length - silentStart;
  const target = Math.round((targetMs / 1000) * sampleRate);
  if (silent === 0 || silent >= target || silentStart < window) return pcm;
  const extended = new Float32Array(pcm.length + (target - silent));
  extended.set(pcm);
  for (let offset = pcm.length; offset < extended.length; offset += silent) {
    extended.set(pcm.subarray(silentStart, silentStart + Math.min(silent, extended.length - offset)), offset);
  }
  return extended;
}
