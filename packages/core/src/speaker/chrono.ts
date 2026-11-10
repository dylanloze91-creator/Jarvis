/**
 * Chrono d'une phrase d'enceinte : durées et chemin seulement.
 * Jamais le texte dit, jamais une clé, jamais un chemin de fichier.
 */

export const SPEAKER_CHRONO_MEMORY = 50;
export const SPEAKER_CHRONO_BARS = 20;
/** En-tête facultatif : fin de parole sur la carte → début d'envoi, en millisecondes. */
export const SPEAKER_HEADER_CAPTURE_MS = 'x-jarvis-capture-ms';

export const SPEAKER_CHRONO_PATHS = ['reflexe', 'express', 'trieur', 'cerveau'] as const;
export type SpeakerChronoPath = (typeof SPEAKER_CHRONO_PATHS)[number];

export interface SpeakerChronoSample {
  audioMs: number;
  captureMs: number | null;
  transcriptionMs: number;
  decisionMs: number;
  path: SpeakerChronoPath;
  firstTextMs: number | null;
  spokenReadyMs: number | null;
  synthesisMs: number | null;
  /** Premier morceau de son réellement écrit sur le flux. */
  firstSoundMs: number | null;
  responseMs: number | null;
  totalMs: number;
}

const SAMPLE_KEYS = [
  'audioMs',
  'captureMs',
  'transcriptionMs',
  'decisionMs',
  'path',
  'firstTextMs',
  'spokenReadyMs',
  'synthesisMs',
  'firstSoundMs',
  'responseMs',
  'totalMs',
] as const;

export const SPEAKER_CHRONO_STEPS: ReadonlyArray<{ id: keyof SpeakerChronoSample; label: string }> = [
  { id: 'captureMs', label: 'la prise de son' },
  { id: 'audioMs', label: "l'audio" },
  { id: 'transcriptionMs', label: 'la transcription' },
  { id: 'decisionMs', label: 'le choix' },
  { id: 'firstTextMs', label: 'la réponse du modèle' },
  { id: 'spokenReadyMs', label: 'le texte à dire' },
  { id: 'synthesisMs', label: 'la voix' },
  { id: 'firstSoundMs', label: 'le premier son' },
  { id: 'responseMs', label: "l'envoi" },
];

export interface SpeakerChronoStepView {
  id: string;
  label: string;
  medianMs: number;
  slowest: boolean;
}

export interface SpeakerChronoView {
  sentence: string;
  steps: SpeakerChronoStepView[];
}

function finiteMs(value: unknown, allowNull: boolean): number | null {
  if (value === null && allowNull) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return allowNull ? null : 0;
  return Math.min(600_000, Math.round(value));
}

/** Ne garde que les durées et le chemin. Tout autre champ (texte, clé) disparaît. */
export function sanitizeChronoSample(input: SpeakerChronoSample): SpeakerChronoSample {
  const path = SPEAKER_CHRONO_PATHS.includes(input.path) ? input.path : 'cerveau';
  return {
    audioMs: finiteMs(input.audioMs, false) ?? 0,
    captureMs: finiteMs(input.captureMs, true),
    transcriptionMs: finiteMs(input.transcriptionMs, false) ?? 0,
    decisionMs: finiteMs(input.decisionMs, false) ?? 0,
    path,
    firstTextMs: finiteMs(input.firstTextMs, true),
    spokenReadyMs: finiteMs(input.spokenReadyMs, true),
    synthesisMs: finiteMs(input.synthesisMs, true),
    firstSoundMs: finiteMs(input.firstSoundMs, true),
    responseMs: finiteMs(input.responseMs, true),
    totalMs: finiteMs(input.totalMs, false) ?? 0,
  };
}

/** Une ligne JSON. Lève si une valeur n'est pas une durée ou un chemin connu. */
export function chronoLine(sample: SpeakerChronoSample): string {
  const clean = sanitizeChronoSample(sample);
  const record = clean as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!SAMPLE_KEYS.includes(key as (typeof SAMPLE_KEYS)[number])) {
      throw new Error('Le chrono ne peut pas contenir autre chose que des durées.');
    }
    const value = record[key];
    if (key === 'path') {
      if (!SPEAKER_CHRONO_PATHS.includes(value as SpeakerChronoPath)) {
        throw new Error('Chemin de chrono inconnu.');
      }
      continue;
    }
    if (value !== null && typeof value !== 'number') {
      throw new Error('Le chrono ne contient pas de texte.');
    }
  }
  return JSON.stringify(clean);
}

export function readCaptureMs(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 120_000) return null;
  return parsed;
}

export function medianMs(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  const text = seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1);
  return text.replace('.', ',');
}

/** Médianes des dernières phrases, pour les barres des réglages. */
export function chronoView(samples: readonly SpeakerChronoSample[]): SpeakerChronoView {
  const recent = samples.slice(-SPEAKER_CHRONO_BARS);
  if (recent.length === 0) {
    return { sentence: 'Pas encore de phrase mesurée.', steps: [] };
  }
  const steps: SpeakerChronoStepView[] = [];
  for (const step of SPEAKER_CHRONO_STEPS) {
    const values: number[] = [];
    for (const sample of recent) {
      const value = sample[step.id];
      if (typeof value === 'number') values.push(value);
    }
    if (values.length === 0) continue;
    steps.push({ id: step.id, label: step.label, medianMs: medianMs(values), slowest: false });
  }
  let slowestIndex = 0;
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index]!.medianMs > steps[slowestIndex]!.medianMs) slowestIndex = index;
  }
  const slowestStep = steps[slowestIndex];
  if (slowestStep) steps[slowestIndex] = { ...slowestStep, slowest: true };
  const slowest = steps[slowestIndex];
  const sentence = slowest
    ? `Le plus long : ${slowest.label}, ${formatSeconds(slowest.medianMs)} s.`
    : 'Pas encore de phrase mesurée.';
  return { sentence, steps };
}

export class SpeakerChrono {
  private samples: SpeakerChronoSample[] = [];

  constructor(private readonly persist?: { append(line: string): void; clear(): void }) {}

  record(sample: SpeakerChronoSample): SpeakerChronoSample {
    const clean = sanitizeChronoSample(sample);
    this.samples.push(clean);
    if (this.samples.length > SPEAKER_CHRONO_MEMORY) {
      this.samples.splice(0, this.samples.length - SPEAKER_CHRONO_MEMORY);
    }
    this.persist?.append(chronoLine(clean));
    return clean;
  }

  replace(samples: SpeakerChronoSample[]): void {
    this.samples = samples.slice(-SPEAKER_CHRONO_MEMORY).map((sample) => sanitizeChronoSample(sample));
  }

  last(count = SPEAKER_CHRONO_BARS): SpeakerChronoSample[] {
    return this.samples.slice(-count);
  }

  view(): SpeakerChronoView {
    return chronoView(this.samples);
  }

  reset(): void {
    this.samples = [];
    this.persist?.clear();
  }
}
