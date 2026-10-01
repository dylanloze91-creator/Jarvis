/**
 * Index des extraits gardés pour l'apprentissage du réveil, plafond en
 * nombre et en taille, politique de réentraînement et compteurs sur 7 jours.
 * Pur : le stockage disque (dossier de données de l'appli) est côté main.
 */
import type { WakeLabel, WakeStatKind } from './labeling.js';
import type { WakeTrainingSample } from './verifier.js';

export type WakeSampleSource = 'wake' | 'retry' | 'enrollment' | 'background';

export interface WakeSampleEntry {
  id: string;
  label: WakeLabel;
  source: WakeSampleSource;
  createdAt: number;
  /** Taille de l'extrait audio sur disque (0 pour un fond sonore : caractéristiques seules, pas d'audio). */
  bytes: number;
  features: number[];
}

export interface WakeSampleCap {
  /** Extraits audio (réveils, reprises, enregistrement de départ). */
  maxClips: number;
  maxClipBytes: number;
  /** Fonds sonores : caractéristiques seulement, jamais d'audio. */
  maxBackground: number;
}

/** ~300 extraits de 2 s en WAV 16 bits (64 Ko chacun) ≈ 19 Mo au plus. */
export const DEFAULT_WAKE_SAMPLE_CAP: WakeSampleCap = {
  maxClips: 300,
  maxClipBytes: 20 * 1024 * 1024,
  maxBackground: 200,
};

/** Nouveaux exemples avant un réentraînement automatique. */
export const RETRAIN_AFTER_NEW_SAMPLES = 5;

/**
 * Identifiants à supprimer pour respecter le plafond. On retire d'abord le
 * plus ancien de la classe la plus fournie (l'équilibre positifs/négatifs
 * compte plus que l'ancienneté), l'enregistrement de départ en dernier.
 */
export function samplesOverCap(entries: WakeSampleEntry[], cap: WakeSampleCap = DEFAULT_WAKE_SAMPLE_CAP): string[] {
  const removed: string[] = [];
  const background = entries.filter((entry) => entry.source === 'background').sort((a, b) => a.createdAt - b.createdAt);
  while (background.length > cap.maxBackground) removed.push(background.shift()!.id);

  const clips = entries.filter((entry) => entry.source !== 'background');
  let count = clips.length;
  let bytes = clips.reduce((sum, entry) => sum + entry.bytes, 0);
  const pools: Record<WakeLabel, WakeSampleEntry[]> = {
    positive: clips.filter((entry) => entry.label === 'positive').sort(evictionOrder),
    negative: clips.filter((entry) => entry.label === 'negative').sort(evictionOrder),
  };
  while ((count > cap.maxClips || bytes > cap.maxClipBytes) && count > 0) {
    const pool = pools.positive.length >= pools.negative.length ? pools.positive : pools.negative;
    const victim = pool.shift() ?? pools.positive.shift() ?? pools.negative.shift();
    if (!victim) break;
    removed.push(victim.id);
    count -= 1;
    bytes -= victim.bytes;
  }
  return removed;
}

function evictionOrder(a: WakeSampleEntry, b: WakeSampleEntry): number {
  const keepA = a.source === 'enrollment' ? 1 : 0;
  const keepB = b.source === 'enrollment' ? 1 : 0;
  return keepA - keepB || a.createdAt - b.createdAt;
}

export function shouldRetrain(newSamplesSinceTraining: number, force = false): boolean {
  return force || newSamplesSinceTraining >= RETRAIN_AFTER_NEW_SAMPLES;
}

export function trainingSet(entries: WakeSampleEntry[]): WakeTrainingSample[] {
  return entries.map((entry) => ({ features: entry.features, label: entry.label === 'positive' ? 1 : 0 }));
}

export interface WakeStatEvent {
  at: number;
  kind: WakeStatKind;
}

export interface WakeStatsSummary {
  successes: number;
  misses: number;
  falseWakes: number;
  days: number;
}

export const WAKE_STATS_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Événements des 7 derniers jours seulement (les plus anciens sont oubliés). */
export function pruneWakeStats(events: WakeStatEvent[], now: number, days = WAKE_STATS_DAYS): WakeStatEvent[] {
  return events.filter((event) => now - event.at <= days * DAY_MS && event.at <= now + DAY_MS);
}

export function summarizeWakeStats(events: WakeStatEvent[], now: number, days = WAKE_STATS_DAYS): WakeStatsSummary {
  const recent = pruneWakeStats(events, now, days);
  return {
    successes: recent.filter((event) => event.kind === 'success').length,
    misses: recent.filter((event) => event.kind === 'miss').length,
    falseWakes: recent.filter((event) => event.kind === 'false-wake').length,
    days,
  };
}
