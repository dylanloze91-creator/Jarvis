/**
 * Modèles libérés après usage (27 novembre 2026).
 *
 * Constat sur le PC de l'utilisateur (RTX 2060, 6 Go) : le modèle du chef d'orchestre restait chargé
 * sans limite (« Garder Jarvis éveillé » des enceintes : `keep_alive` négatif ; modèles gardés chauds
 * de Jarvis Test : prolongés toutes les 8 minutes). Avec 4,2 Go pris en permanence, la mémoire de la
 * carte était pleine et l'affichage de Windows saccadait, même sans rien demander à Jarvis.
 *
 * Règle : un modèle chargé pour la discussion est gardé tant qu'on se sert de Jarvis, puis libéré
 * `MODEL_IDLE_RELEASE_MS` après le dernier usage (un tour de discussion, un réveil d'enceinte). Il se
 * recharge tout seul à la demande suivante. Jarvis ne libère que ses propres modèles de discussion,
 * jamais celui d'une mission, d'une image ou d'un autre programme.
 */
import { activeOrchestra, activeRouter, type OrchestraSettingsLike } from './orchestra.js';
import { ORCHESTRA_TEAMS, teamAssignment } from './orchestraTeams.js';

/** Sans usage pendant ce temps, les modèles de discussion encore chargés sont libérés. */
export const MODEL_IDLE_RELEASE_MS = 10 * 60_000;
/** Rythme du contrôle (une lecture de la liste des modèles chargés, seulement au repos). */
export const MODEL_IDLE_CHECK_MS = 60_000;

interface IdleSettings {
  provider: string;
  model?: string;
  orchestra?: OrchestraSettingsLike | undefined;
}

/** Même modèle, que le nom porte ou non l'étiquette `:latest`. */
function sameModel(a: string, b: string): boolean {
  const full = (name: string): string => (name.includes(':') ? name : `${name}:latest`).toLowerCase();
  return full(a.trim()) === full(b.trim());
}

/**
 * Les modèles que Jarvis charge pour la discussion : celui du chat, et avec le chef d'orchestre
 * celui qui trie, le cerveau et chaque équipe. Fournisseur autre qu'Ollama : aucun.
 */
export function discussionModels(settings: IdleSettings): string[] {
  if (settings.provider !== 'ollama') return [];
  const names: string[] = [];
  const push = (name: string | undefined): void => {
    const clean = (name ?? '').trim();
    if (clean && !names.some((known) => sameModel(known, clean))) names.push(clean);
  };
  push(settings.model);
  const orchestra = activeOrchestra(settings);
  if (orchestra) {
    push(activeRouter(settings)?.model);
    push(orchestra.brain);
    for (const team of ORCHESTRA_TEAMS) push(teamAssignment(orchestra, team).model);
  }
  return names;
}

/** Parmi les modèles chargés dans Ollama, ceux de la discussion : les seuls que Jarvis libère au repos. */
export function modelsToRelease(settings: IdleSettings, loaded: readonly string[]): string[] {
  const ours = discussionModels(settings);
  return loaded.filter((name) => ours.some((model) => sameModel(model, name)));
}

/** Au repos depuis assez longtemps, et rien en cours (tour, mission, image, entraînement). */
export function idleLongEnough(input: { now: number; lastUse: number; busy: boolean; idleMs?: number }): boolean {
  if (input.busy) return false;
  return input.now - input.lastUse >= (input.idleMs ?? MODEL_IDLE_RELEASE_MS);
}
