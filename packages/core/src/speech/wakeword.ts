/**
 * Détection locale du mot de réveil, entièrement hors ligne : aucun appel
 * réseau, aucune dépendance à un moteur de reconnaissance. L'algorithme
 * compare l'enveloppe d'énergie du flux audio en cours aux échantillons
 * enregistrés par l'utilisateur ("Jarvis") — une technique volontairement
 * simple (reconnaissance par gabarit), remplaçable sans toucher au reste de
 * l'application par un moteur dédié (Vosk, Porcupine, openWakeWord…).
 *
 * Ce module ne fait que des calculs sur des `number[]` : il n'a besoin ni du
 * micro, ni du DOM. La capture audio (Web Audio API) reste dans
 * `apps/desktop`, qui alimente ce détecteur trame par trame.
 */
export interface WakeWordProfile {
  /**
   * Un gabarit par échantillon enregistré, chacun de longueur fixe
   * (`WAKE_WORD_PROFILE_LENGTH`). Plusieurs prononciations du même mot
   * réduisent nettement les faux négatifs, la voix variant d'une fois à
   * l'autre.
   */
  envelopes: number[][];
}

export interface WakeWordDetectorOptions {
  /** Durée d'une trame d'énergie, en millisecondes. */
  frameMs: number;
  /** Durée de la fenêtre glissante comparée aux gabarits, en millisecondes. */
  windowMs: number;
  /** Sensibilité de 0 (très strict) à 1 (très permissif). */
  sensitivity: number;
  /** Délai minimal entre deux détections successives, en millisecondes. */
  cooldownMs: number;
  /**
   * Énergie de crête minimale dans la fenêtre pour qu'elle soit candidate.
   * Sans ce garde-fou, le silence — dont l'enveloppe normalisée est plate —
   * ressemble à n'importe quel gabarit et déclenche à tort.
   */
  minPeakEnergy: number;
}

export const defaultWakeWordOptions: WakeWordDetectorOptions = {
  frameMs: 30,
  windowMs: 900,
  sensitivity: 0.5,
  cooldownMs: 1500,
  minPeakEnergy: 0.02,
};

export const WAKE_WORD_PROFILE_LENGTH = 24;

const STRICT_THRESHOLD = 0.94;
const PERMISSIVE_THRESHOLD = 0.62;

/** Traduit la sensibilité exposée à l'utilisateur en seuil de similarité. */
export function thresholdForSensitivity(sensitivity: number): number {
  const clamped = Math.min(1, Math.max(0, sensitivity));
  return STRICT_THRESHOLD - clamped * (STRICT_THRESHOLD - PERMISSIVE_THRESHOLD);
}

export interface WakeWordDetection {
  detected: boolean;
  /**
   * Meilleure similarité mesurée sur la fenêtre courante, de 0 à 1. Exposée
   * pour que l'interface puisse afficher un indicateur pendant la
   * calibration et aider au réglage de la sensibilité.
   */
  score: number;
  /** Seuil au-delà duquel la détection se déclenche, pour l'affichage. */
  threshold: number;
}

const NO_DETECTION: WakeWordDetection = { detected: false, score: 0, threshold: 0 };

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

  setSensitivity(sensitivity: number): void {
    this.options.sensitivity = sensitivity;
  }

  hasProfile(): boolean {
    return (this.profile?.envelopes.length ?? 0) > 0;
  }

  get threshold(): number {
    return thresholdForSensitivity(this.options.sensitivity);
  }

  reset(): void {
    this.buffer = [];
    this.cooldownUntil = 0;
  }

  /**
   * À appeler pour chaque trame audio, avec son énergie RMS (0 à ~1).
   * Renvoie le score de la fenêtre courante et si le mot vient d'être détecté.
   */
  pushEnergy(rms: number, now: number = Date.now()): WakeWordDetection {
    this.buffer.push(rms);
    const framesInWindow = Math.max(4, Math.round(this.options.windowMs / this.options.frameMs));
    if (this.buffer.length > framesInWindow) {
      this.buffer = this.buffer.slice(this.buffer.length - framesInWindow);
    }

    if (!this.hasProfile() || now < this.cooldownUntil || this.buffer.length < framesInWindow) {
      return NO_DETECTION;
    }

    const threshold = this.threshold;
    if (Math.max(...this.buffer) < this.options.minPeakEnergy) {
      return { detected: false, score: 0, threshold };
    }

    const score = this.scoreWindow(this.buffer);
    if (score >= threshold) {
      this.cooldownUntil = now + this.options.cooldownMs;
      this.buffer = [];
      return { detected: true, score, threshold };
    }
    return { detected: false, score, threshold };
  }

  /** Meilleure similarité entre la fenêtre et l'un des gabarits enregistrés. */
  private scoreWindow(window: number[]): number {
    const envelopes = this.profile?.envelopes ?? [];
    if (envelopes.length === 0) return 0;

    const candidate = normalize(resample(window, envelopes[0]!.length));
    let best = 0;
    for (const envelope of envelopes) {
      best = Math.max(best, cosineSimilarity(candidate, envelope));
    }
    return best;
  }
}

/** Construit un gabarit à partir d'un enregistrement brut (RMS par trame). */
export function buildWakeWordEnvelope(
  energyFrames: number[],
  length: number = WAKE_WORD_PROFILE_LENGTH,
): number[] {
  return normalize(resample(energyFrames, length));
}

export function buildWakeWordProfile(samples: number[][]): WakeWordProfile {
  return {
    envelopes: samples
      .filter((sample) => sample.length > 0)
      .map((sample) => buildWakeWordEnvelope(sample)),
  };
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
