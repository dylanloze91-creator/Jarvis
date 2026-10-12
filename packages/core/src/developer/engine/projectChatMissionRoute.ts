import { suggestMissionKind } from './router.js';
import { isProjectChatDirectRequest } from './projectChatDirect.js';

const EXPLICIT_NEW =
  /\b(nouveau projet|nouvelle appli|nouvelle application|from scratch|depuis zéro|depuis zero)\b/i;
const NEW_GAME_BRIEF =
  /\b(crée|créer|creer|fais|fabrique|construis|compose)\b[\s\S]{0,160}\b(jeu de plateforme|plateforme 2d|nouveau jeu|jeu dans le navigateur)\b/i;

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
  if (EXPLICIT_NEW.test(t)) return true;
  if (NEW_GAME_BRIEF.test(t)) return true;
  if (/\b(jeu de plateforme|plateforme 2d)\b/i.test(t) && t.length >= 24) return true;
  if (suggestMissionKind(t) === 'skill') return true;
  return false;
}
