/**
 * Détection locale du mot de réveil, entièrement hors ligne : aucun appel
 * réseau, aucune dépendance à un moteur de reconnaissance. L'algorithme
 * compare l'enveloppe d'énergie du flux audio en cours à un court
 * échantillon enregistré une fois par l'utilisateur ("Jarvis") — une
 * technique volontairement simple (reconnaissance par gabarit), suffisante
 * pour un MVP et remplaçable sans toucher au reste de l'application par un
 * moteur dédié (Vosk, Porcupine, openWakeWord…) le jour où une meilleure
 * précision est nécessaire.
 *
 * Ce module ne fait que des calculs sur des `number[]` : il n'a besoin ni du
 * micro, ni du DOM. La capture audio (Web Audio API) reste dans
 * `apps/desktop`, qui alimente ce détecteur trame par trame.
 */
export interface WakeWordProfile {
  /** Enveloppe d'énergie normalisée, de longueur fixe (`profileLength`). */
  envelope: number[];
}

export interface WakeWordDetectorOptions {
  /** Durée d'une trame d'énergie, en millisecondes. */
  frameMs: number;
  /** Durée de la fenêtre glissante comparée au gabarit, en millisecondes. */
  windowMs: number;
  /** Similarité cosinus minimale (0 à 1) pour déclencher la détection. */
  threshold: number;
  /** Délai minimal entre deux détections successives, en millisecondes. */
  cooldownMs: number;
}

export const defaultWakeWordOptions: WakeWordDetectorOptions = {
  frameMs: 30,
  windowMs: 900,
  threshold: 0.72,
  cooldownMs: 1500,
};

export const WAKE_WORD_PROFILE_LENGTH = 24;

export class WakeWordDetector {
  private readonly options: WakeWordDetectorOptions;
  private buffer: number[] = [];
  private cooldownUntil = 0;

  constructor(
    private profile: WakeWordProfile | null,
    options: Partial<WakeWordDetectorOptions> = {},
  ) {
    this.options = { ...defaultWakeWordOptions, ...options };
  }

  setProfile(profile: WakeWordProfile | null): void {
    this.profile = profile;
    this.buffer = [];
  }

  hasProfile(): boolean {
    return this.profile !== null;
  }

  reset(): void {
    this.buffer = [];
    this.cooldownUntil = 0;
  }

  /**
   * À appeler pour chaque trame audio, avec son énergie RMS (0 à ~1).
   * Renvoie `true` si le mot de réveil vient d'être détecté.
   */
  pushEnergy(rms: number, now: number = Date.now()): boolean {
    this.buffer.push(rms);
    const framesInWindow = Math.max(4, Math.round(this.options.windowMs / this.options.frameMs));
    if (this.buffer.length > framesInWindow) {
      this.buffer = this.buffer.slice(this.buffer.length - framesInWindow);
    }

    if (!this.profile || now < this.cooldownUntil || this.buffer.length < framesInWindow) {
      return false;
    }

    const candidate = resample(this.buffer, this.profile.envelope.length);
    const similarity = cosineSimilarity(normalize(candidate), this.profile.envelope);

    if (similarity >= this.options.threshold) {
      this.cooldownUntil = now + this.options.cooldownMs;
      this.buffer = [];
      return true;
    }
    return false;
  }
}

/** Construit un gabarit à partir d'un enregistrement brut (RMS par trame). */
export function buildWakeWordProfile(
  energyFrames: number[],
  length: number = WAKE_WORD_PROFILE_LENGTH,
): WakeWordProfile {
  return { envelope: normalize(resample(energyFrames, length)) };
}

export function resample(values: number[], length: number): number[] {
  if (values.length === 0) return new Array(length).fill(0);
  if (values.length === length) return [...values];

  const out = new Array<number>(length);
  const scale = (values.length - 1) / Math.max(1, length - 1);
  for (let index = 0; index < length; index += 1) {
    const position = index * scale;
    const lower = Math.floor(position);
    const upper = Math.min(values.length - 1, lower + 1);
    const fraction = position - lower;
    out[index] = values[lower]! * (1 - fraction) + values[upper]! * fraction;
  }
  return out;
}

export function normalize(values: number[]): number[] {
  const max = Math.max(...values, 1e-9);
  return values.map((value) => value / max);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index]! * b[index]!;
    normA += a[index]! * a[index]!;
    normB += b[index]! * b[index]!;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
