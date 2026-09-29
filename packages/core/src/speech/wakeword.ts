/**
 * Détection locale du mot de réveil, entièrement hors ligne : aucun appel
 * réseau, aucune dépendance à un moteur de reconnaissance. L'algorithme
 * compare l'enveloppe d'énergie du flux audio en cours à un ou plusieurs
 * échantillons enregistrés par l'utilisateur ("Jarvis") — une technique
 * volontairement simple (reconnaissance par gabarit), mais soignée : elle
 * accepte plusieurs enregistrements, compare au meilleur ou à la moyenne des
 * gabarits, expose un réglage de sensibilité et un score en temps réel pour
 * calibrer correctement. Il tourne à côté d'openWakeWord pour un « Jarvis »
 * nu, et Whisper confirme chaque candidat.
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
  /**
   * Énergie de crête minimale dans la fenêtre pour qu'elle soit candidate.
   * Sans ce garde-fou, le silence — dont l'enveloppe normalisée est plate —
   * ressemble à n'importe quel gabarit et déclenche dans le vide.
   */
  minPeakEnergy: number;
}

export const defaultWakeWordOptions: WakeWordDetectorOptions = {
  frameMs: 30,
  windowMs: 900,
  threshold: 0.56,
  cooldownMs: 1500,
  minPeakEnergy: 0.012,
};

export const WAKE_WORD_PROFILE_LENGTH = 24;

/**
 * Durée minimale / maximale d'une rafale retenue comme prise vocale. En
 * dessous, c'est un clic ou un artefact ; au-delà, ce n'est plus un mot de
 * réveil isolé.
 */
export const WAKE_WORD_BURST_DURATION_MS = { min: 240, max: 1800 };

/** Taux de passages par zéro plausible pour de la parole (ni sinus pur, ni souffle). */
export const WAKE_WORD_SPEECH_ZCR = { min: 0.004, max: 0.4 };

/**
 * Bornes de la plage de seuils balayée par le réglage de sensibilité (0 à 1).
 * Volontairement moins strictes qu'un détecteur d'enveloppe seul : Whisper
 * confirme ensuite le candidat, donc on préfère trop de candidats à trop peu.
 */
export const SENSITIVITY_THRESHOLD_RANGE = { min: 0.4, max: 0.78 };

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

    if (this.profiles.length === 0 || Math.max(...this.buffer) < this.options.minPeakEnergy) {
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

/**
 * Découpe un PCM mono en trames d'énergie RMS. Utilisé pour un enregistrement
 * micro comme pour un fichier WAV/MP3 importé : même gabarit, jamais de
 * données d'entraînement Whisper.
 */
export function energyFramesFromPcm(
  pcm: Float32Array,
  sampleRate: number,
  frameMs: number = defaultWakeWordOptions.frameMs,
): number[] {
  const frameSize = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  if (pcm.length === 0) return [];
  if (pcm.length < frameSize) return [computeRms(pcm)];

  const frames: number[] = [];
  for (let offset = 0; offset + frameSize <= pcm.length; offset += frameSize) {
    frames.push(computeRms(pcm.subarray(offset, offset + frameSize)));
  }
  const remainder = pcm.length % frameSize;
  if (remainder >= Math.ceil(frameSize / 2)) {
    frames.push(computeRms(pcm.subarray(pcm.length - remainder)));
  }
  return frames;
}

export type WakeWordClipRejectReason = 'empty' | 'silent' | 'non-speech';

export type WakeWordProfileFromPcmResult =
  | { ok: true; profile: WakeWordProfile }
  | { ok: false; reason: WakeWordClipRejectReason };

export type WakeWordProfilesFromPcmResult =
  | { ok: true; profiles: WakeWordProfile[] }
  | { ok: false; reason: WakeWordClipRejectReason };

export interface SpeechBurstRange {
  startFrame: number;
  endFrame: number;
  peakEnergy: number;
}

/**
 * Taux de passages par zéro d'un PCM : la parole voisée oscille, un silence
 * ou un sinus presque pur presque pas, un souffle blanc beaucoup trop.
 */
export function zeroCrossingRate(pcm: Float32Array): number {
  if (pcm.length < 2) return 0;
  let crossings = 0;
  for (let index = 1; index < pcm.length; index += 1) {
    if ((pcm[index - 1]! >= 0) !== (pcm[index]! >= 0)) crossings += 1;
  }
  return crossings / (pcm.length - 1);
}

function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 1e-9) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function framesForWindow(
  windowMs: number = defaultWakeWordOptions.windowMs,
  frameMs: number = defaultWakeWordOptions.frameMs,
): number {
  return Math.max(4, Math.round(windowMs / frameMs));
}

/**
 * Isole les rafales d'énergie assez longues pour être une prise vocale.
 * Fusionne les micro-trous (< 120 ms) pour ne pas couper un « Jarvis » en
 * deux syllabes. Ne décide pas encore si c'est de la parole (voir ZCR).
 */
export function extractSpeechBurstRanges(
  energies: number[],
  frameMs: number = defaultWakeWordOptions.frameMs,
  minPeakEnergy: number = defaultWakeWordOptions.minPeakEnergy,
): { ok: true; ranges: SpeechBurstRange[] } | { ok: false; reason: WakeWordClipRejectReason } {
  if (energies.length === 0) return { ok: false, reason: 'empty' };
  const peak = Math.max(...energies);
  if (peak < minPeakEnergy) return { ok: false, reason: 'silent' };

  const threshold = Math.max(minPeakEnergy, peak * 0.18);
  const mergeGapFrames = Math.max(1, Math.round(120 / frameMs));
  const minFrames = Math.max(1, Math.round(WAKE_WORD_BURST_DURATION_MS.min / frameMs));
  const maxFrames = Math.max(minFrames, Math.round(WAKE_WORD_BURST_DURATION_MS.max / frameMs));

  const ranges: SpeechBurstRange[] = [];
  let index = 0;
  while (index < energies.length) {
    if ((energies[index] ?? 0) < threshold) {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < energies.length) {
      if ((energies[index] ?? 0) >= threshold) {
        index += 1;
        continue;
      }
      let lookAhead = index;
      while (
        lookAhead < energies.length &&
        lookAhead - index < mergeGapFrames &&
        (energies[lookAhead] ?? 0) < threshold
      ) {
        lookAhead += 1;
      }
      if (lookAhead < energies.length && (energies[lookAhead] ?? 0) >= threshold) {
        index = lookAhead;
        continue;
      }
      break;
    }
    const end = index;
    const duration = end - start;
    if (duration < minFrames || duration > maxFrames) continue;
    const slice = energies.slice(start, end);
    if (coefficientOfVariation(slice) < 0.12) continue;
    ranges.push({
      startFrame: start,
      endFrame: end,
      peakEnergy: Math.max(...slice),
    });
  }

  if (ranges.length === 0) return { ok: false, reason: 'non-speech' };
  return { ok: true, ranges };
}

/**
 * Recadre une rafale dans une fenêtre de la même durée que le détecteur en
 * direct (`windowMs`). Sans ça, un fichier de 10 s resample en 24 points ne
 * ressemble plus du tout à la fenêtre glissante de 900 ms.
 */
export function paddedEnergyWindow(
  energies: number[],
  startFrame: number,
  endFrame: number,
  windowFrames: number = framesForWindow(),
): number[] {
  const burstLength = Math.max(0, endFrame - startFrame);
  if (burstLength >= windowFrames) {
    let bestStart = startFrame;
    let bestSum = -1;
    const lastStart = endFrame - windowFrames;
    for (let start = startFrame; start <= lastStart; start += 1) {
      let sum = 0;
      for (let index = start; index < start + windowFrames; index += 1) {
        sum += energies[index] ?? 0;
      }
      if (sum > bestSum) {
        bestSum = sum;
        bestStart = start;
      }
    }
    return energies.slice(bestStart, bestStart + windowFrames);
  }

  const pad = windowFrames - burstLength;
  const left = Math.floor(pad / 2);
  const out = new Array<number>(windowFrames).fill(0);
  for (let index = 0; index < burstLength; index += 1) {
    out[left + index] = energies[startFrame + index] ?? 0;
  }
  return out;
}

function pcmSliceForBurst(
  pcm: Float32Array,
  sampleRate: number,
  range: SpeechBurstRange,
  frameMs: number,
): Float32Array {
  const frameSize = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const start = range.startFrame * frameSize;
  const end = Math.min(pcm.length, range.endFrame * frameSize);
  return pcm.subarray(start, end);
}

function isSpeechLikePcm(pcm: Float32Array): boolean {
  const zcr = zeroCrossingRate(pcm);
  return zcr >= WAKE_WORD_SPEECH_ZCR.min && zcr <= WAKE_WORD_SPEECH_ZCR.max;
}

/**
 * Transforme un PCM mono en un ou plusieurs gabarits : une prise par rafale
 * vocale, recadrée sur `windowMs`. Silence, fichier vide, clic, sinus pur
 * ou souffle sont rejetés — ils ne doivent pas entrer dans le profil.
 */
export function buildWakeWordProfilesFromPcm(
  pcm: Float32Array,
  sampleRate: number,
  minPeakEnergy: number = defaultWakeWordOptions.minPeakEnergy,
): WakeWordProfilesFromPcmResult {
  const energies = energyFramesFromPcm(pcm, sampleRate);
  const extracted = extractSpeechBurstRanges(
    energies,
    defaultWakeWordOptions.frameMs,
    minPeakEnergy,
  );
  if (!extracted.ok) return extracted;

  const windowFrames = framesForWindow();
  const profiles: WakeWordProfile[] = [];
  for (const range of extracted.ranges) {
    const slice = pcmSliceForBurst(pcm, sampleRate, range, defaultWakeWordOptions.frameMs);
    if (!isSpeechLikePcm(slice)) continue;
    profiles.push(buildWakeWordProfile(paddedEnergyWindow(energies, range.startFrame, range.endFrame, windowFrames)));
  }

  if (profiles.length === 0) return { ok: false, reason: 'non-speech' };
  return { ok: true, profiles };
}

/**
 * Un seul gabarit : la rafale vocale la plus énergétique du clip. Conservé
 * pour les appels existants (enregistrement micro d'une prise à la fois).
 */
export function buildWakeWordProfileFromPcm(
  pcm: Float32Array,
  sampleRate: number,
  minPeakEnergy: number = defaultWakeWordOptions.minPeakEnergy,
): WakeWordProfileFromPcmResult {
  const result = buildWakeWordProfilesFromPcm(pcm, sampleRate, minPeakEnergy);
  if (!result.ok) return result;
  let best = result.profiles[0]!;
  let bestPeak = 0;
  for (const profile of result.profiles) {
    const peak = Math.max(...profile.envelope);
    if (peak >= bestPeak) {
      best = profile;
      bestPeak = peak;
    }
  }
  return { ok: true, profile: best };
}

/**
 * Même isolation de rafale, à partir de trames RMS déjà calculées (chemin
 * micro : on n'a pas le PCM sous la main). Pas de filtre ZCR ici.
 */
export function buildWakeWordProfileFromEnergyFrames(
  energies: number[],
  minPeakEnergy: number = defaultWakeWordOptions.minPeakEnergy,
): WakeWordProfileFromPcmResult {
  const extracted = extractSpeechBurstRanges(
    energies,
    defaultWakeWordOptions.frameMs,
    minPeakEnergy,
  );
  if (!extracted.ok) return extracted;
  const loudest = extracted.ranges.reduce((best, range) =>
    range.peakEnergy > best.peakEnergy ? range : best,
  );
  return {
    ok: true,
    profile: buildWakeWordProfile(
      paddedEnergyWindow(energies, loudest.startFrame, loudest.endFrame),
    ),
  };
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

/**
 * Candidat « rafale de parole » : assez d'énergie d'affilée, sans gabarit.
 * Sert de premier étage quand l'utilisateur n'a pas encore enregistré
 * d'échantillon — Whisper tranche ensuite. Pur, testable, sans micro.
 */
export class SpeechBurstDetector {
  private consecutive = 0;
  private cooldownUntil = 0;

  constructor(
    private readonly framesNeeded: number,
    private readonly minEnergy: number,
    private readonly cooldownMs: number,
  ) {}

  push(rms: number, now: number = Date.now()): boolean {
    if (now < this.cooldownUntil) {
      this.consecutive = 0;
      return false;
    }
    if (rms >= this.minEnergy) this.consecutive += 1;
    else this.consecutive = 0;
    if (this.consecutive < this.framesNeeded) return false;
    this.consecutive = 0;
    this.cooldownUntil = now + this.cooldownMs;
    return true;
  }

  reset(): void {
    this.consecutive = 0;
    this.cooldownUntil = 0;
  }
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
