import type { Settings } from '@jarvis/core';

/**
 * 5.0.64 — « Enregistrer » n'envoie que les clés que le brouillon a changées.
 * Le processus principal écrit certains blocs de son côté pendant que le panneau
 * est ouvert (`localLearning` : modèle adopté par l'apprentissage, dates ;
 * `machine`, `toolPolicies` enregistrés tout de suite) : renvoyer tout le
 * brouillon les remettait à l'état d'avant l'ouverture du panneau.
 */
export function settingsPatch(base: Settings, draft: Settings): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as Array<keyof Settings>) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(base[key])) patch[key] = draft[key];
  }
  return patch as Partial<Settings>;
}
