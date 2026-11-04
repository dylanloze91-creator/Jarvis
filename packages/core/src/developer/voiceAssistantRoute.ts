import { classifyUtterance } from '../learning/continuous.js';
import { chatMissionsEnabled } from './chatMissionsSettings.js';
import { isProjectChatDirectRequest } from './engine/projectChatDirect.js';
import type { Settings } from '../settings.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundaryPattern(words: readonly string[]): RegExp {
  const body = words.map((word) => escapeRegExp(word)).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(${body})(?![\\p{L}\\p{N}])`, 'iu');
}

/** Phrase vocale après « Jarvis » : construire ou modifier app, jeu, outil ou code → développeur. */
const BUILD_VERBS = [
  'crée',
  'créer',
  'creer',
  'construis',
  'construire',
  'modifie',
  'modifier',
  'corrige',
  'corriger',
  'ajoute',
  'ajouter',
  'change',
  'changer',
  'développe',
  'développer',
  'developpe',
  'developper',
  'programme',
  'programmer',
  'implémente',
  'implemente',
  'implement',
  'build',
  'fixe',
  'fix',
  'améliore',
  'améliorer',
  'refactor',
  'refactorise',
  'écris',
  'écrire',
  'ecris',
  'ecrire',
  'mets à jour',
  'met à jour',
] as const;

const BUILD_VERB = wordBoundaryPattern(BUILD_VERBS);

const DEV_SUBJECT =
  /\b(app|appli|application|jeu|outil|programme|projet|code|script|site|page|cli|interface|fenêtre|dépôt|fichier|typescript|javascript|react|vite|godot|unity|snake|pong|tetris|monorepo|npm|electron)\b/iu;

const CLASSIC_ONLY =
  /\b(météo|agenda|mail|e-?mail|spotify|chrome|actualité|musique|capture d[' ]écran|rappelle[- ]moi|recherche web)\b/iu;

const BUILD_PHRASE =
  /\b(fais(-moi)?|je veux|j'aimerais|j aimerais|peux-tu|tu peux).{0,50}(un |une |mon |ma )?(jeu|appli|application|outil|programme|projet)\b/iu;

const CODE_AS_NOUN =
  /\b(?:g[- ]?code|qr\s+code|code\s+postal|code\s+barre|postal\s+code|zip\s+code)\b/iu;

/** « code / coder » comme verbe, pas dans G-code ni code postal. */
function hasCodeVerb(text: string): boolean {
  if (CODE_AS_NOUN.test(text)) return false;
  return /(?<![-\p{L}\p{N}])(?:code|coder)(?![-\p{L}\p{N}])/iu.test(text);
}

function hasBuildOrChangeVerb(text: string): boolean {
  return BUILD_VERB.test(text) || hasCodeVerb(text);
}

export function isDeveloperVoiceIntent(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  if (CODE_AS_NOUN.test(t) && !hasBuildOrChangeVerb(t)) return false;
  if (/\b(quel temps|météo|temps qu['']il|il fait)\b/iu.test(t)) return false;
  if (CLASSIC_ONLY.test(t) && !hasBuildOrChangeVerb(t) && !BUILD_PHRASE.test(t)) return false;
  if (
    isProjectChatDirectRequest(t) &&
    (hasBuildOrChangeVerb(t) || DEV_SUBJECT.test(t) || BUILD_PHRASE.test(t))
  ) {
    return true;
  }
  if (BUILD_PHRASE.test(t)) return true;
  if (hasBuildOrChangeVerb(t) && DEV_SUBJECT.test(t)) return true;
  if (/\b(mon|ma|mes)\s+(jeu|app|appli|outil|projet|programme|code)\b/iu.test(t) && hasBuildOrChangeVerb(t)) {
    return true;
  }
  return false;
}

/** Ancien aiguillage fenêtre discussion → panneau Développeur (avant 5.0.68 / missions depuis le chat). */
export function shouldOpenDeveloperPanelForChatInput(text: string, settings: Settings): boolean {
  if (chatMissionsEnabled(settings)) return false;
  if (classifyUtterance(text) !== 'one-off') return false;
  return isDeveloperVoiceIntent(text);
}
