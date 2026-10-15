import { suggestMissionKind } from './router.js';
import { isProjectChatDirectRequest } from './projectChatDirect.js';

const EXPLICIT_NEW =
  /(?:^|[^\p{L}\p{N}_])(nouveau projet|nouvelle appli|nouvelle application|from scratch|depuis zéro|depuis zero)(?=$|[^\p{L}\p{N}_])/iu;

const BUILD_VERBS = [
  'crée',
  'créer',
  'creer',
  'créé',
  'cree',
  'fais',
  'fait',
  'faire',
  'fabrique',
  'fabriquer',
  'construis',
  'construire',
  'compose',
  'composer',
  'génère',
  'générer',
  'genere',
  'generer',
  'développe',
  'développer',
  'developpe',
  'developper',
  'programme',
  'programmer',
  'build',
  'code',
  'coder',
  'écris',
  'écrire',
  'ecris',
  'ecrire',
  'prépare',
  'prepare',
  'installe',
  'installer',
  'monte',
] as const;

const PRODUCTS = [
  'jeu',
  'jeux',
  'game',
  'appli',
  'application',
  'app',
  'programme',
  'outil',
  'cli',
  'site',
  'plateforme',
  'platformer',
  'projet',
  'phaser',
  'p5',
  'pixi',
  'three',
] as const;

const EDIT_VERBS = [
  'augmente',
  'augmenter',
  'change',
  'changer',
  'corrige',
  'corriger',
  'modifie',
  'modifier',
  'retire',
  'supprime',
  'fixe',
  'réduis',
  'reduis',
  'diminue',
] as const;

const CODE_QUESTION =
  /^\s*(pourquoi|comment marche|comment fonctionne|comment ça|comment ca|où |ou est|c'est quoi|c’est quoi|qu'est-ce|qu’est-ce|explique|dis-moi|dis moi)\b/iu;

/** Mot entier, y compris s’il commence par É/è (\\b de JS ignore ces lettres). */
function mentions(text: string, words: readonly string[]): boolean {
  const body = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${body})(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
}

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
export function isCreateOrBuildOrder(text: string, template: string | null = null): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (explicitNewProjectFromChat(t)) return false;
  if (CODE_QUESTION.test(t)) return false;
  const product = mentions(t, PRODUCTS) || /\bmario\b/iu.test(t);
  if (!product) return false;
  const creates = mentions(t, BUILD_VERBS);
  const edits = mentions(t, EDIT_VERBS);
  if (edits && !creates) return false;
  if (/\?\s*$/.test(t) && !creates) return false;
  if (template && edits) return false;
  if (creates) return true;
  if (
    /\b(je veux|je voudrais|j'aimerais|j’aimerais|j aimerais|il me faut|il faut|peux-tu|tu peux)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // Projet encore vide : « jeu de plateforme 2D » est déjà l’ordre, pas une question.
  return !template;
}

/** Gabarit web-game : une retouche ciblée reste directe. Un ordre de création non. */
export function isExistingWebGameChange(text: string, template: string | null): boolean {
  if (template !== 'web-game') return false;
  if (explicitNewProjectFromChat(text) || isCreateOrBuildOrder(text, template)) return false;
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
  if (isCreateOrBuildOrder(text, project.template)) {
    return project.jarvis ? 'jarvis-not-target' : 'supervise-open';
  }
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
