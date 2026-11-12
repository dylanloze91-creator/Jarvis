/**
 * Réglages du carnet, dans leur propre fichier.
 * `parseSettings` ne les connaît pas.
 */
import {
  CARNET_FORMAT_VERSION,
  DEFAULT_SPEAKER_FIRST_SOUND_MS,
  DEFAULT_WINDOW_FIRST_WORD_MS,
  type CarnetEdition,
  type CarnetSettingsFile,
} from './types.js';

export function defaultCarnetSettings(edition: CarnetEdition): CarnetSettingsFile {
  return {
    version: CARNET_FORMAT_VERSION,
    enabled: edition === 'test',
    fenetrePremierMotMs: DEFAULT_WINDOW_FIRST_WORD_MS,
    enceintePremierSonMs: DEFAULT_SPEAKER_FIRST_SOUND_MS,
  };
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

/** Fichier absent ou abîmé : les défauts de l'édition. Un booléen explicite est respecté. */
export function parseCarnetSettings(raw: unknown, edition: CarnetEdition): CarnetSettingsFile {
  const base = defaultCarnetSettings(edition);
  if (!raw || typeof raw !== 'object') return base;
  const record = raw as Record<string, unknown>;
  return {
    version: CARNET_FORMAT_VERSION,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : base.enabled,
    fenetrePremierMotMs: positive(record.fenetrePremierMotMs, base.fenetrePremierMotMs),
    enceintePremierSonMs: positive(record.enceintePremierSonMs, base.enceintePremierSonMs),
  };
}
