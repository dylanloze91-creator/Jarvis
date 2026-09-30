/**
 * Fiabilité du mot de réveil, sans changer le moteur : buffer circulaire,
 * fenêtres glissantes, seuil déjà porté par la sensibilité, et un cooldown
 * qui empêche un second déclenchement.
 */

export class CircularPcmBuffer {
  private chunks: Float32Array[] = [];
  private samples = 0;

  constructor(private readonly capacity: number) {}

  push(frame: Float32Array): void {
    if (frame.length === 0) return;
    const copy = frame.slice();
    this.chunks.push(copy);
    this.samples += copy.length;
    while (this.samples > this.capacity && this.chunks.length > 1) {
      const removed = this.chunks.shift();
      if (!removed) break;
      this.samples -= removed.length;
    }
  }

  snapshot(): Float32Array {
    const out = new Float32Array(this.samples);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  clear(): void {
    this.chunks = [];
    this.samples = 0;
  }
}

export class WakeTriggerGate {
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly cooldownMs: number) {}

  /** Vrai une seule fois par fenêtre de cooldown. */
  allow(now: number): boolean {
    if (now - this.last < this.cooldownMs) return false;
    this.last = now;
    return true;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

/** Fenêtres glissantes sur un buffer déjà accumulé. */
export function slidingWindows(pcm: Float32Array, windowSize: number, hop: number): Float32Array[] {
  if (windowSize <= 0 || hop <= 0 || pcm.length < windowSize) return [];
  const windows: Float32Array[] = [];
  for (let offset = 0; offset + windowSize <= pcm.length; offset += hop) {
    windows.push(pcm.slice(offset, offset + windowSize));
  }
  return windows;
}
