/**
 * Ce que le banc de vitesse refait du démarrage de l'appli avant la première demande :
 * le préchauffage des modèles, quand l'édition le prévoit. Rend sa durée, ou `null` s'il
 * n'y en a pas eu.
 */
import type { Settings } from '@jarvis/core';
import { edition } from '../edition.js';
import { ModelWarmer } from './chauds.js';

export async function benchStartup(input: { settings: Settings }): Promise<number | null> {
  if (!edition().keepModelsWarm) return null;
  const started = Date.now();
  const report = await new ModelWarmer({ getSettings: () => input.settings }).prewarm();
  for (const item of report.done) console.log(`[banc] préchauffé : ${item.model} en ${item.ms} ms`);
  for (const item of report.skipped) console.log(`[banc] non préchauffé : ${item.model} (${item.reason})`);
  return report.done.length ? Date.now() - started : null;
}
