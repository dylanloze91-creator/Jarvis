import { suggestMissionKind } from './router.js';
import { isProjectChatDirectRequest } from './projectChatDirect.js';

const EXPLICIT_NEW =
  /\b(nouveau projet|nouvelle appli|nouvelle application|from scratch|depuis zéro|depuis zero)\b/i;

const BUILD_VERB =
  /\b(crée|créer|creer|créé|cree|fais|fait|faire|fabrique|fabriquer|construis|construire|compose|composer|génère|générer|genere|generer|développe|développer|developpe|developper|programme|programmer|build|code|coder|écris|écrire|ecris|ecrire)\b/i;

const BUILD_TARGET =
  /\b(jeu|jeux|game|appli|application|app|programme|outil|cli|site|page|plateforme|platformer|projet)\b/i;

const QUESTION_START =
  /^\s*(pourquoi|comment|est-ce que|qu'est-ce|qu’est-ce|c'est quoi|c’est quoi|explique|dis-moi|dis moi)\b/i;

export type ProjectChatOrderRoute =
  | 'new-folder'
  | 'supervise-open'
  | 'direct'
  | 'discuss'
  | 'jarvis-not-target';

/** Dossier neuf : seulement les mots « nouveau projet » (et une compétence). */
export function explicitNewProjectFromChat(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (EXPLICIT_NEW.test(t)) return true;
  if (suggestMissionKind(t) === 'skill') return true;
  return false;
}

/**
 * Ordre de créer ou construire un jeu ou une appli.
 * Un plan dans le chat n’est pas cet ordre : le Superviseur doit l’exécuter.
 */
export function isCreateOrBuildOrder(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (explicitNewProjectFromChat(t)) return false;
  if (QUESTION_START.test(t)) return false;
  if (/\?\s*$/.test(t) && !BUILD_VERB.test(t)) return false;
  const target = BUILD_TARGET.test(t) || /\bmario\b/i.test(t);
  if (!target) return false;
  if (BUILD_VERB.test(t)) return true;
  return /\b(je veux|je voudrais|j'aimerais|j’aimerais|j aimerais|il me faut|il faut|peux-tu|tu peux)\b/i.test(
    t,
  );
}

/** Gabarit web-game : une retouche ciblée reste directe. Un ordre de création non. */
export function isExistingWebGameChange(text: string, template: string | null): boolean {
  if (template !== 'web-game') return false;
  if (explicitNewProjectFromChat(text) || isCreateOrBuildOrder(text)) return false;
  return isProjectChatDirectRequest(text);
}

/**
 * Vrai seulement pour un dossier neuf (mots « nouveau projet », compétence).
 * « Crée un jeu » dans le projet ouvert n’ouvre pas un autre dossier.
 */
export function newProjectMissionFromProjectChat(text: string): boolean {
  return explicitNewProjectFromChat(text);
}

export function routeProjectChatOrder(
  text: string,
  project: { jarvis: boolean; template: string | null },
  withScreenshot = false,
): ProjectChatOrderRoute {
  if (explicitNewProjectFromChat(text)) return 'new-folder';
  if (isCreateOrBuildOrder(text)) return project.jarvis ? 'jarvis-not-target' : 'supervise-open';
  if (
    !withScreenshot &&
    (isExistingWebGameChange(text, project.template) ||
      (isProjectChatDirectRequest(text) && project.template === 'web-game'))
  ) {
    return 'direct';
  }
  if (isProjectChatDirectRequest(text) && !withScreenshot && !project.jarvis) return 'direct';
  return 'discuss';
}
