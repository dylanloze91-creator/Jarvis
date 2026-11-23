/**
 * Options de chargement d'un modèle, exactement comme le chat les envoie.
 *
 * Ollama recharge un modèle déjà en mémoire dès qu'une requête le demande avec un autre `num_ctx`
 * ou `num_gpu`. Le 23 novembre 2026, trois appels ne précisaient rien et Ollama prenait son
 * contexte par défaut (4 096) : le préchauffage des enceintes, le rechargement après une image et
 * la reformulation d'Imager. Le 7B du cerveau, demandé partout ailleurs en 8 192, était alors
 * rechargé deux fois (10 chargements en 4 096 du 13 au 23 novembre). Ces appels prennent
 * maintenant les options de cette fonction.
 */
import { activeOrchestra, activeRouter } from '../agent/orchestra.js';
import { ORCHESTRA_TEAMS, teamAssignment, type ModelPlace } from '../agent/orchestraTeams.js';
import { chatOllamaOptions } from '../machine/profile.js';
import { OLLAMA_RECOMMENDED_NUM_CTX } from '../providers/ollama.js';
import type { Settings } from '../settings.js';

export interface OllamaLoadOptions {
  num_ctx: number;
  num_gpu?: number;
}

/** Place où le chef d'orchestre fait tourner ce modèle ; le cerveau (carte) passe en premier. */
function placeOf(settings: Settings, model: string): ModelPlace | null {
  const orchestra = activeOrchestra(settings);
  if (!orchestra) return null;
  if (model === orchestra.brain) return 'carte';
  const router = activeRouter(settings);
  if (router?.model === model) return router.place;
  for (const team of ORCHESTRA_TEAMS) {
    const assignment = teamAssignment(orchestra, team);
    if (assignment.model === model) return assignment.place;
  }
  return null;
}

/**
 * Options que la session enverrait pour ce modèle : `num_ctx` 8 192 et `num_gpu` 0 sur le
 * processeur avec le chef d'orchestre (`orchestraProviderConfig`), sinon celles du chat
 * (`chatOllamaOptions`, profil de la machine).
 */
export function ollamaLoadOptions(settings: Settings, model: string): OllamaLoadOptions {
  const place = placeOf(settings, model);
  if (place) {
    return { num_ctx: OLLAMA_RECOMMENDED_NUM_CTX, ...(place === 'processeur' ? { num_gpu: 0 } : {}) };
  }
  const chat = settings.provider === 'ollama' ? chatOllamaOptions(settings) : undefined;
  return {
    num_ctx: chat?.numCtx ?? OLLAMA_RECOMMENDED_NUM_CTX,
    ...(chat?.numGpu !== undefined ? { num_gpu: chat.numGpu } : {}),
  };
}
