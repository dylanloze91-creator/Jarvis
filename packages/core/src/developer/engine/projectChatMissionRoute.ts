import { suggestMissionKind } from './router.js';
import { isProjectChatDirectRequest } from './projectChatDirect.js';

const GAME_CREATE =
  /\b(jeu|jeux|game|platformer|plateforme|side[- ]scroller|pong|snake|tetris|arcade)\b/i;
const CREATE_INTENT =
  /\b(crée|créer|cree|creer|fais|fait|fabrique|construis|construire|compose|génère|genere|développe|developpe|lance|démarre|demarre)\b/i;
const SOFT_CREATE = /\b(je veux|je voudrais|j'aimerais|j aimerais|besoin de)\b/i;

/** Gabarit web-game : modifications ciblées restent en exécution directe. */
export function isExistingWebGameChange(text: string, template: string | null): boolean {
  if (template !== 'web-game') return false;
  if (newProjectMissionFromProjectChat(text)) return false;
  return isProjectChatDirectRequest(text);
}

/**
 * Discussion projet → mission « Nouveau projet » (plateforme 2D, appli, CLI…),
 * pas une modification directe sur Jarvis ou un dépôt non adapté.
 */
export function newProjectMissionFromProjectChat(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  const kind = suggestMissionKind(t);
  if (kind === 'new-project' || kind === 'skill') return true;
  if (GAME_CREATE.test(t)) {
    if (CREATE_INTENT.test(t) || SOFT_CREATE.test(t)) return true;
    if (/\b(gabarit|niveau jouable|vue de côté|vue de cote|parcours|jouable)\b/i.test(t)) {
      return true;
    }
  }
  if (
    /\b(nouveau projet|nouvelle appli|nouvelle application|from scratch|depuis zéro|depuis zero)\b/i.test(
      t,
    )
  )
    return true;
  return false;
}
