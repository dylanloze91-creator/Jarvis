/**
 * Ce que le banc de vitesse refait du démarrage de l'appli avant la première demande.
 * Pour l'instant : rien (aucun préchauffage). `null` : rien n'a été fait.
 */
import type { ProviderRegistry, Settings } from '@jarvis/core';

export async function benchStartup(_input: {
  settings: Settings;
  registry: ProviderRegistry;
  toolNames: string[];
}): Promise<number | null> {
  return null;
}
