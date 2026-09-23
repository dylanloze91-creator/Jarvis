/**
 * Détection locale du mot de réveil, entièrement hors ligne : aucun appel
 * réseau, aucune dépendance à un moteur de reconnaissance. L'algorithme
 * compare l'enveloppe d'énergie du flux audio en cours à un ou plusieurs
 * échantillons enregistrés par l'utilisateur ("Jarvis") — une technique
 * volontairement simple (reconnaissance par gabarit), mais soignée : elle
 * accepte plusieurs enregistrements, compare au meilleur ou à la moyenne des
 * gabarits, expose un réglage de sensibilité et un score en temps réel pour
 * calibrer correctement. C'est le chemin par défaut de l'application — pas
 * un simple repli — précisément parce qu'il ne coûte rien et ne dépend
 * d'aucun compte externe. Un moteur tiers (Porcupine…) reste une option
 * derrière `WakeWordEngine`, jamais requis.
 *
 * Ce module ne fait que des calculs sur des `number[]` : il n'a besoin ni du
 * micro, ni du DOM. La capture audio (Web Audio API) reste dans
 * `apps/desktop`, qui alimente ce détecteur trame par trame.
 */
export interface WakeWordProfile {
  /** Enveloppe d'énergie normalisée, de longueur fixe (`profileLength`). */
  envelope: number[];
}

export type WakeWordMatchStrategy = 'best' | 'average';

export interface WakeWordDetectorConfig {
  /** Un ou plusieurs échantillons enregistrés par l'utilisateur. */
  profiles: WakeWordProfile[];
  /**
   * `best` : similarité maximale parmi tous les gabarits (tolère la
   * variabilité entre enregistrements). `average` : gabarit moyen unique
   * (lisse le bruit si les enregistrements sont homogènes).
   */
  matchStrategy: WakeWordMatchStrategy;
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

/** Bornes de la plage de seuils balayée par le réglage de sensibilité (0 à 1). */
export const SENSITIVITY_THRESHOLD_RANGE = { min: 0.55, max: 0.92 };

/**
 * Convertit une sensibilité utilisateur (0 = strict, 1 = très sensible) en
 * seuil de similarité cosinus. Plus la sensibilité est haute, plus le seuil
 * est bas — le mot de réveil se déclenche plus facilement, au prix de plus
 * de faux positifs.
 */
export function sensitivityToThreshold(sensitivity: number): number {
  const clamped = Math.min(1, Math.max(0, sensitivity));
  const { min, max } = SENSITIVITY_THRESHOLD_RANGE;
  return max - clamped * (max - min);
}

/** Opération inverse de `sensitivityToThreshold`, pour préremplir un réglage à partir d'un seuil existant. */
export function thresholdToSensitivity(threshold: number): number {
  const { min, max } = SENSITIVITY_THRESHOLD_RANGE;
  const clamped = Math.min(max, Math.max(min, threshold));
  return (max - clamped) / (max - min);
}

export class WakeWordDetector {
  private readonly options: WakeWordDetectorOptions;
  private profiles: WakeWordProfile[];
  private matchStrategy: WakeWordMatchStrategy;
  private averaged: WakeWordProfile | null = null;
  private buffer: number[] = [];
  private cooldownUntil = 0;
  private lastScore = 0;

  constructor(
    config: WakeWordDetectorConfig | null,
    options: Partial<WakeWordDetectorOptions> = {},
  ) {
    this.options = { ...defaultWakeWordOptions, ...options };
    this.profiles = config?.profiles ?? [];
    this.matchStrategy = config?.matchStrategy ?? 'best';
    this.recomputeAverage();
  }

  setConfig(config: WakeWordDetectorConfig | null): void {
    this.profiles = config?.profiles ?? [];
    this.matchStrategy = config?.matchStrategy ?? 'best';
    this.recomputeAverage();
    this.buffer = [];
  }

  setSensitivity(sensitivity: number): void {
    this.options.threshold = sensitivityToThreshold(sensitivity);
  }

  hasProfile(): boolean {
    return this.profiles.length > 0;
  }

  /** Score de similarité (0 à 1) de la dernière trame analysée, pour un retour visuel en direct pendant la calibration. */
  getLastScore(): number {
    return this.lastScore;
  }

  reset(): void {
    this.buffer = [];
    this.cooldownUntil = 0;
    this.lastScore = 0;
  }

  /**
   * À appeler pour chaque trame audio, avec son énergie RMS (0 à ~1).
   * Renvoie `true` si le mot de réveil vient d'être détecté. Met aussi à
   * jour `getLastScore()`, y compris quand aucune détection n'est déclenchée.
   */
  pushEnergy(rms: number, now: number = Date.now()): boolean {
    this.buffer.push(rms);
    const framesInWindow = Math.max(4, Math.round(this.options.windowMs / this.options.frameMs));
    if (this.buffer.length > framesInWindow) {
      this.buffer = this.buffer.slice(this.buffer.length - framesInWindow);
    }

    if (this.profiles.length === 0) {
      this.lastScore = 0;
      return false;
    }

    const candidate = normalize(resample(this.buffer, WAKE_WORD_PROFILE_LENGTH));
    this.lastScore = this.scoreAgainstProfiles(candidate);

    if (now < this.cooldownUntil || this.buffer.length < framesInWindow) {
      return false;
    }

    if (this.lastScore >= this.options.threshold) {
      this.cooldownUntil = now + this.options.cooldownMs;
      this.buffer = [];
      return true;
    }
    return false;
  }

  private scoreAgainstProfiles(candidate: number[]): number {
    if (this.matchStrategy === 'average') {
      return this.averaged ? cosineSimilarity(candidate, this.averaged.envelope) : 0;
    }
    let best = 0;
    for (const profile of this.profiles) {
      best = Math.max(best, cosineSimilarity(candidate, profile.envelope));
    }
    return best;
  }

  private recomputeAverage(): void {
    this.averaged = this.profiles.length > 0 ? averageProfiles(this.profiles) : null;
  }
}

/** Construit un gabarit à partir d'un enregistrement brut (RMS par trame). */
export function buildWakeWordProfile(
  energyFrames: number[],
  length: number = WAKE_WORD_PROFILE_LENGTH,
): WakeWordProfile {
  return { envelope: normalize(resample(energyFrames, length)) };
}

/** Moyenne élément par élément de plusieurs gabarits (déjà de même longueur). */
export function averageProfiles(profiles: WakeWordProfile[]): WakeWordProfile {
  const length = profiles[0]?.envelope.length ?? WAKE_WORD_PROFILE_LENGTH;
  const sums = new Array<number>(length).fill(0);
  for (const profile of profiles) {
    for (let index = 0; index < length; index += 1) {
      sums[index] = (sums[index] ?? 0) + (profile.envelope[index] ?? 0);
    }
  }
  return { envelope: sums.map((sum) => sum / profiles.length) };
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

/** RMS (racine de la moyenne des carrés) d'une trame PCM — mesure d'énergie/volume, sans dépendance DOM. */
export function computeRms(frame: Float32Array): number {
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  return Math.sqrt(sum / frame.length);
}
