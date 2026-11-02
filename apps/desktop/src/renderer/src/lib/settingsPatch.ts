import type { Settings } from '@jarvis/core';

/**
 * 5.0.64 — « Enregistrer » n'envoie que les clés que le brouillon a changées.
 * Le processus principal écrit certains blocs de son côté pendant que le panneau
 * est ouvert (`localLearning` : modèle adopté par l'apprentissage, dates ;
 * `machine`, `toolPolicies` enregistrés tout de suite) : renvoyer tout le
 * brouillon les remettait à l'état d'avant l'ouverture du panneau.
 *
 * `base` doit être l'instantané pris à la création du brouillon (`SettingsDraft.base`),
 * jamais les réglages courants : comparé aux réglages courants, un réglage changé
 * ailleurs pendant que le brouillon attendait (Développeur, politique de confirmation,
 * `localLearning`) ressortait comme « modifié » et « Enregistrer » le défaisait.
 */
export function settingsPatch(base: Settings, draft: Settings): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as Array<keyof Settings>) {
    if (!sameValue(draft[key], base[key])) patch[key] = draft[key];
  }
  return patch as Partial<Settings>;
}

/** Brouillon des réglages et l'instantané des réglages dont il est parti. */
export interface SettingsDraft {
  /** Réglages tels qu'ils étaient quand l'utilisateur a commencé à modifier. */
  base: Settings;
  /** `base` plus les modifications de l'utilisateur. */
  draft: Settings;
}

/**
 * Les réglages enregistrés ont changé ailleurs (micro ou Développeur enregistrés tout de
 * suite, politique de confirmation, apprentissage local) pendant que le brouillon était
 * ouvert : le brouillon prend la nouvelle valeur de chaque clé que l'utilisateur n'a pas
 * touchée, garde les siennes, et la base devient les réglages enregistrés. Ainsi
 * `settingsPatch(base, draft)` ne contient toujours que les clés changées par l'utilisateur.
 */
export function absorbSavedSettings(current: SettingsDraft, saved: Settings): SettingsDraft {
  const draft: Record<string, unknown> = { ...saved };
  for (const key of Object.keys(current.draft) as Array<keyof Settings>) {
    if (!sameValue(current.draft[key], current.base[key])) draft[key] = current.draft[key];
  }
  return { base: saved, draft: draft as Settings };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
