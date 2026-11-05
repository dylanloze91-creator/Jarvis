import {
  stripTrailingWakeWord,
} from '../../speech/addressee.js';
import type { WakeWordTextMatchConfig } from '../../speech/wakeWordTextMatch.js';
import type { ProposerMissionType } from './proposerMission.js';
import { proposerMissionSchema } from './proposerMission.js';

/** Question ou extrait pédagogique : réponse écrite, pas proposer_mission. */
const CODE_QUESTION =
  /^(?:c['’]est quoi|qu['’]est[- ]ce que|explique|définis|define|what is|how does)\b/iu;

export function looksLikeCodeExplanationOnly(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (/^\s*comment\b/iu.test(t)) return true;
  if (/^\s*pourquoi\b/iu.test(t)) return true;
  if (/^\s*(?:quel|quelle|quels|quelles)\b/iu.test(t)) return true;
  if (/^\s*qu['’]est[- ]ce\b/iu.test(t)) return true;
  if (/^\s*est-ce que\b/iu.test(t)) {
    if (/^\s*est-ce que tu (?:peux|pourrais)\b/iu.test(t)) return false;
    return true;
  }
  if (CODE_QUESTION.test(t)) return true;
  if (/^\s*comment on\b/iu.test(t)) return true;
  if (/^\s*montre[- ]moi un exemple\b/iu.test(t) && !/\b(crée|créer|fais|ajoute|corrige)\b/iu.test(t)) {
    return true;
  }
  if (/\btu me conseilles\b|\bconseille(s)?-moi\b|\bquel langage\b/iu.test(t) && !/\b(crée|créer|fais|fabrique|écris|ecris|code)\b/iu.test(t)) {
    return true;
  }
  return false;
}

const DEFAULT_WAKE: WakeWordTextMatchConfig = { word: 'jarvis' };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(text: string, words: readonly string[]): boolean {
  const body = words.map((word) => escapeRegExp(word)).join('|');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${body})(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
}

const CREATE_OR_EDIT_VERBS = [
  'crée',
  'créer',
  'creer',
  'fais',
  'faire',
  'fabrique',
  'fabriquer',
  'écris-moi',
  'ecris-moi',
  'écris moi',
  'ecris moi',
  'code-moi',
  'code moi',
  'développe',
  'développer',
  'developpe',
  'developper',
  'programme',
  'programmer',
  'ajoute',
  'ajouter',
  'modifie',
  'modifier',
  'change',
  'changer',
  'corrige',
  'corriger',
  'répare',
  'repare',
  'réparer',
  'reparer',
  'documente',
  'documenter',
  'écris',
  'ecris',
  'écrire',
  'ecrire',
  'construis',
  'construire',
  'génère',
  'générer',
  'genere',
  'generer',
  'installe',
  'installer',
  'prépare',
  'prepare',
] as const;

const EDIT_VERBS = ['ajoute', 'ajouter', 'modifie', 'modifier', 'change', 'changer'] as const;

const CODE_OBJECTS = [
  'script',
  'programme',
  'appli',
  'application',
  'logiciel',
  'jeu',
  'site',
  'page web',
  'outil',
  'fonction',
  'bouton',
  'bug',
  'fichier',
  'projet',
  'module',
  'cli',
  'app',
] as const;

const LANGUAGE_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bpython\b|\.py\b/iu, label: 'Python' },
  { pattern: /\bbash\b|\bsh\b/iu, label: 'bash' },
  { pattern: /\bpowershell\b|\bps1\b/iu, label: 'PowerShell' },
  { pattern: /\brust\b|\bcargo\b/iu, label: 'Rust' },
  { pattern: /\bgo\b|\bgolang\b/iu, label: 'Go' },
  { pattern: /\bjava\b(?!\s*script)/iu, label: 'Java' },
  { pattern: /\bc\+\+\b|\bcpp\b/iu, label: 'C++' },
  { pattern: /\bphp\b/iu, label: 'PHP' },
  { pattern: /\bjavascript\b|\btypescript\b|\bnode\b(?!\s*modules)/iu, label: 'JavaScript' },
  { pattern: /\bc#\b|\bdotnet\b|\.net\b/iu, label: 'C#' },
];

export interface DirectMissionRequest {
  type: ProposerMissionType;
  objectif: string;
  langage?: string;
}

export interface DirectMissionDetectOptions {
  wakeWord?: WakeWordTextMatchConfig;
  knownProjectNames?: readonly string[];
}

const LEADING_WAKE =
  /^(?:bonjour|salut|dis|ok|eh|allô|allo|hey|coucou)[,\s]+(?:jarvis|friday|jeeves|djeeves)[,\s]+/iu;
const LEADING_WAKE_ONLY = /^(?:jarvis|friday|jeeves|djeeves)[,\s]+/iu;
const POLITE_PREFIX =
  /^(?:tu peux me|est-ce que tu pourrais|pourrais-tu|peux-tu|j'aimerais que tu|j aimerais que tu|il me faudrait|s'il te plaît,?|stp|merci de)\s+/iu;

export function cleanMissionObjective(text: string, wake: WakeWordTextMatchConfig = DEFAULT_WAKE): string {
  let t = text.trim();
  t = t.replace(LEADING_WAKE, '');
  t = t.replace(LEADING_WAKE_ONLY, '');
  t = t.replace(POLITE_PREFIX, '');
  t = stripTrailingWakeWord(t, wake);
  return t.replace(/\s+/g, ' ').trim();
}

function mentionsKnownProject(text: string, knownProjectNames: readonly string[]): boolean {
  if (/\bjarvis\b/iu.test(text)) return true;
  for (const name of knownProjectNames) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue;
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegExp(trimmed)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text)) {
      return true;
    }
  }
  return false;
}

function inferMissionType(text: string, knownProjectNames: readonly string[]): ProposerMissionType {
  if (/\b(bug|erreur)\b/iu.test(text) || mentions(text, ['corrige', 'corriger', 'répare', 'repare', 'réparer', 'reparer'])) {
    return 'corriger';
  }
  if (mentions(text, ['documente', 'documenter']) || /\breadme\b/iu.test(text) || /\bdoc\b/iu.test(text)) {
    return 'documenter';
  }
  if (mentions(text, EDIT_VERBS) && mentionsKnownProject(text, knownProjectNames)) {
    return 'modifier';
  }
  return 'nouveau-projet';
}

export function detectRequestedLanguage(text: string): string | null {
  for (const rule of LANGUAGE_RULES) {
    if (rule.pattern.test(text)) return rule.label;
  }
  return null;
}

export function isJarvisSupportedLanguage(lang: string | null | undefined): boolean {
  if (!lang) return true;
  const n = lang.toLowerCase();
  return (
    n.includes('javascript') ||
    n.includes('typescript') ||
    n === 'node' ||
    n.includes('c#') ||
    n.includes('.net') ||
    n.includes('dotnet')
  );
}

export function unsupportedLanguageNotice(lang: string): string {
  return `Jarvis Développeur ne sait pas encore écrire de ${lang}. La mission créera un programme JavaScript (Node) qui fait la même chose.`;
}

export function objectifForMissionLaunch(objectif: string, lang: string | null | undefined): string {
  if (!lang || isJarvisSupportedLanguage(lang)) return objectif.trim();
  return `${objectif.trim()} (en JavaScript / Node, ${lang} non pris en charge)`;
}

export function looksLikeWrittenMissionProposal(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  const labels = ['Objectif :', 'Projet :', 'Type :'];
  const matched = labels.filter((label) => t.includes(label)).length;
  if (matched >= 2) return true;
  return /mission/iu.test(t) && /est-ce que cela te convient/iu.test(t);
}

export function directMissionRequest(
  text: string,
  options: DirectMissionDetectOptions = {},
): DirectMissionRequest | null {
  const wake = options.wakeWord ?? DEFAULT_WAKE;
  const knownProjectNames = options.knownProjectNames ?? [];
  const raw = text.trim();
  if (raw.length < 8) return null;
  if (/^merci\b/iu.test(raw) && raw.length < 24) return null;
  if (looksLikeCodeExplanationOnly(raw)) return null;

  const hasVerb = mentions(raw, CREATE_OR_EDIT_VERBS);
  const hasObject = mentions(raw, CODE_OBJECTS);
  if (!hasVerb || !hasObject) return null;

  const objectif = cleanMissionObjective(raw, wake);
  const parsed = proposerMissionSchema.safeParse({
    type: 'nouveau-projet',
    objectif,
  });
  if (!parsed.success) return null;

  const type = inferMissionType(raw, knownProjectNames);
  const langage = detectRequestedLanguage(raw) ?? undefined;
  return { type, objectif, ...(langage ? { langage } : {}) };
}

/** Filet : phrase utilisateur → mission (type par défaut nouveau-projet si flou). */
export function missionFromUserPhrase(
  text: string,
  options: DirectMissionDetectOptions = {},
): DirectMissionRequest | null {
  const direct = directMissionRequest(text, options);
  if (direct) return direct;
  const objectif = cleanMissionObjective(text, options.wakeWord ?? DEFAULT_WAKE);
  const parsed = proposerMissionSchema.safeParse({ type: 'nouveau-projet', objectif });
  if (!parsed.success) return null;
  const langage = detectRequestedLanguage(text) ?? undefined;
  return { type: 'nouveau-projet', objectif, ...(langage ? { langage } : {}) };
}

export const CHAT_MISSION_DIRECT_INTRO =
  'Je te propose une mission pour ça. Vérifie l’objectif avant de lancer.';
