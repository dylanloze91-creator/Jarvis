import { END_OF_SPEECH_RMS, WAKE_CLIP_SAMPLES, computeRms, resampleLinear } from '@jarvis/core';
import { microphone } from '../audioCapture';

const RATE = 16_000;
const WINDOW = 256;
const MIN_SPEECH_MS = 150;
const MAX_SPEECH_MS = 1_800;
const END_SILENCE_MS = 350;
/** Comme les extraits des vrais réveils : l'extrait finit 150 ms après le mot. */
const TAIL_MS = 150;
export const ENROLLMENT_TAKE_TIMEOUT_MS = 6_000;

export type TakeResult =
  | { status: 'pending' }
  | { status: 'done'; clip: Float32Array }
  | { status: 'too-long' };

/**
 * Une prise d'enrôlement : attend un mot court (« Jarvis ») suivi d'un
 * silence, et rend les 2 s qui finissent juste après. Pur (testable sans micro).
 */
export class WakeTakeDetector {
  private readonly ring = new Float32Array(WAKE_CLIP_SAMPLES + RATE);
  private filled = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private started = false;
  private pendingWindow = new Float32Array(0);

  push(frame: Float32Array, sampleRate: number): TakeResult {
    const at16k = sampleRate === RATE ? frame : resampleLinear(frame, sampleRate, RATE);
    const joined = new Float32Array(this.pendingWindow.length + at16k.length);
    joined.set(this.pendingWindow);
    joined.set(at16k, this.pendingWindow.length);
    let offset = 0;
    for (; offset + WINDOW <= joined.length; offset += WINDOW) {
      const window = joined.subarray(offset, offset + WINDOW);
      this.append(window);
      const result = this.account(computeRms(window));
      if (result.status !== 'pending') return result;
    }
    this.pendingWindow = joined.slice(offset);
    return { status: 'pending' };
  }

  private append(window: Float32Array): void {
    this.ring.copyWithin(0, window.length);
    this.ring.set(window, this.ring.length - window.length);
    this.filled = Math.min(this.ring.length, this.filled + window.length);
  }

  private account(level: number): TakeResult {
    const ms = (WINDOW / RATE) * 1000;
    if (level >= END_OF_SPEECH_RMS) {
      this.speechMs += ms;
      this.silenceMs = 0;
      if (this.speechMs >= MIN_SPEECH_MS) this.started = true;
      if (this.speechMs > MAX_SPEECH_MS) return { status: 'too-long' };
      return { status: 'pending' };
    }
    if (!this.started) {
      // Un bruit bref avant le mot ne compte pas.
      this.speechMs = 0;
      return { status: 'pending' };
    }
    this.silenceMs += ms;
    if (this.silenceMs < END_SILENCE_MS) return { status: 'pending' };
    const drop = Math.round(((this.silenceMs - TAIL_MS) / 1000) * RATE);
    const end = this.ring.length - Math.max(0, drop);
    const clip = new Float32Array(WAKE_CLIP_SAMPLES);
    const start = Math.max(this.ring.length - this.filled, end - WAKE_CLIP_SAMPLES);
    const take = this.ring.subarray(start, end);
    clip.set(take, WAKE_CLIP_SAMPLES - take.length);
    return { status: 'done', clip };
  }
}

/** Écoute le micro partagé jusqu'à une prise (ou délai dépassé). */
export function recordWakeTake(signal?: AbortSignal): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const detector = new WakeTakeDetector();
    const release = microphone.acquire('apprentissage du réveil');
    let unsubscribe = (): void => undefined;
    const finish = (error: Error | null, clip?: Float32Array): void => {
      window.clearTimeout(timer);
      unsubscribe();
      release();
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(clip!);
    };
    const onAbort = (): void => finish(new Error('Enrôlement interrompu.'));
    const timer = window.setTimeout(
      () => finish(new Error('Rien entendu. Rapproche-toi du micro et redis « Jarvis ».')),
      ENROLLMENT_TAKE_TIMEOUT_MS,
    );
    signal?.addEventListener('abort', onAbort);
    unsubscribe = microphone.onFrame((frame, rate) => {
      const result = detector.push(frame, rate);
      if (result.status === 'done') finish(null, result.clip);
      else if (result.status === 'too-long') finish(new Error('Prise trop longue : dis seulement « Jarvis ».'));
    });
  });
}
