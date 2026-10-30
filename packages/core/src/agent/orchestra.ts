/**
 * Chef d'orchestre du chat (5.0.60). Pur : pas de réseau, pas de disque.
 *
 * Une demande suit le premier chemin qui s'applique :
 * 1. **Calcul** : une opération écrite en chiffres est calculée par Jarvis, sans modèle
 *    (un LLM calcule mal de tête ; ici le résultat est exact).
 * 2. **Express** : les règles déjà connues de Jarvis (Spotify, YouTube, actualité, Google,
 *    mémoire, blocage de sites) désignent l'équipe sans appeler de modèle.
 * 3. **Cerveau** : le modèle cerveau lit la demande (et la fin de la conversation) et
 *    répond par le nom d'une équipe. Réponse illisible : Jarvis répond comme avant.
 *
 * L'équipe choisie répond avec son modèle et seulement ses outils.
 */
import type { ChatMessage } from '../types.js';
import type { ProviderConfig } from '../providers/types.js';
import { extractKnowledgeIntent } from '../knowledge/intent.js';
import { looksLikeGoogleIntent, recentlyUsedGoogleTools } from '../google/intent.js';
import { isCurrentTrackQuestion } from '../media/currentTrackIntent.js';
import { isMusicIntent } from '../media/playIntent.js';
import { extractSiteBlockIntent } from '../siteblock/intent.js';
import { extractYoutubeUrl } from '../youtube/url.js';
import { DEFAULT_SYSTEM_PROMPT, looksLikeWebResearchIntent } from './agent.js';
import { detectCurrentInfoIntent } from './currentInfo.js';
import {
  ORCHESTRA_TEAMS,
  TEAM_SPECS,
  teamHasTool,
  type ModelPlace,
  type OrchestraConfig,
  type OrchestraTeam,
} from './orchestraTeams.js';

export * from './orchestraTeams.js';

/* ------------------------------------------------------------------ */
/* 1. Calcul exact, sans modèle                                        */
/* ------------------------------------------------------------------ */

export interface ArithmeticAnswer {
  /** Opération telle qu'affichée (× et ÷). */
  expression: string;
  value: number;
  /** Phrase de réponse, prête à afficher et à dire. */
  reply: string;
}

const LEAD = /^(?:dis[- ]moi\s+)?(?:combien\s+(?:font|fait|ça fait|ca fait|donne)|calcule(?:\s+moi)?|ça fait combien|ca fait combien|c['’]est combien|quel est le résultat de|résultat de)\s*:?\s*/iu;

/** Convertit une phrase en opération (`*`, `/`, `^`) ; `null` si un mot reste. */
export function arithmeticExpression(text: string): string | null {
  let expression = text
    .trim()
    .replace(/[?!.\s]+$/u, '')
    .replace(LEAD, '')
    .replace(/^jarvis[,\s]+/iu, '')
    .replace(LEAD, '');
  if (!/\d/.test(expression)) return null;
  expression = expression
    .replace(/(\d)[\s\u202f\u00a0](?=\d{3}\b)/gu, '$1')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d+(?:\.\d+)?)\s*%\s*(?:de|du|des|d['’])\s*(\d+(?:\.\d+)?)/giu, '($1/100*$2)')
    .replace(/\bau carr[ée](?![a-z])/giu, '^2')
    .replace(/\bau cube(?![a-z])/giu, '^3')
    .replace(/\b(?:puissance|exposant)\b/giu, '^')
    .replace(/\bmultipli[ée]e?s?\s+par\b|\bfois\b|[×x]/giu, '*')
    .replace(/\bdivis[ée]e?s?\s+par\b|÷/giu, '/')
    .replace(/\bplus\b/giu, '+')
    .replace(/\bmoins\b/giu, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/^[\d.+\-*/^() ]+$/.test(expression)) return null;
  // Au moins une vraie opération entre deux nombres.
  if (!/\d\s*\)?\s*[+\-*/^]\s*\(?\s*-?\d/.test(expression)) return null;
  return expression;
}

/** Analyse descendante (+ − × ÷ ^ et parenthèses) : jamais `eval`. `null` si invalide. */
export function evaluateArithmetic(expression: string): number | null {
  const tokens = expression.match(/\d+(?:\.\d+)?|[+\-*/^()]/g);
  if (!tokens || tokens.join('') !== expression.replace(/\s+/g, '')) return null;
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const parseExpression = (): number => {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') value = take() === '+' ? value + parseTerm() : value - parseTerm();
    return value;
  };
  const parseTerm = (): number => {
    let value = parseUnary();
    while (peek() === '*' || peek() === '/') {
      if (take() === '*') value *= parseUnary();
      else {
        const divisor = parseUnary();
        if (divisor === 0) throw new Error('division par zéro');
        value /= divisor;
      }
    }
    return value;
  };
  const parseUnary = (): number => {
    if (peek() === '-') {
      take();
      return -parseUnary();
    }
    if (peek() === '+') {
      take();
      return parseUnary();
    }
    return parsePower();
  };
  const parsePower = (): number => {
    const base = parsePrimary();
    if (peek() === '^') {
      take();
      return base ** parseUnary();
    }
    return base;
  };
  const parsePrimary = (): number => {
    const token = take();
    if (token === undefined) throw new Error('fin inattendue');
    if (token === '(') {
      const value = parseExpression();
      if (take() !== ')') throw new Error('parenthèse');
      return value;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error('nombre');
    return value;
  };
  try {
    const value = parseExpression();
    if (index !== tokens.length || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function frenchNumber(value: number): string {
  const rounded = Math.abs(value) < 1e15 ? Number(value.toPrecision(12)) : value;
  return rounded.toLocaleString('fr-FR', { maximumFractionDigits: 10 }).replace(/[\u202f\u00a0]/g, ' ');
}

/** Demande qui n'est qu'une opération (« combien font 12 fois 37 ? ») : résultat exact. */
export function solveArithmetic(text: string): ArithmeticAnswer | null {
  const expression = arithmeticExpression(text);
  if (!expression) return null;
  const value = evaluateArithmetic(expression);
  if (value === null) return null;
  const shown = expression
    .replace(/\(([\d.]+)\/100\*([\d.]+)\)/g, '$1 % de $2')
    .replace(/\*/g, ' × ')
    .replace(/\//g, ' ÷ ')
    .replace(/\^/g, ' ^ ')
    .replace(/\s+/g, ' ')
    .replace(/(\d)\.(\d)/g, '$1,$2')
    .trim();
  return { expression: shown, value, reply: `${shown} = ${frenchNumber(value)}` };
}

/* ------------------------------------------------------------------ */
/* 1 bis. Heure et date, lues sur l'horloge du PC                      */
/* ------------------------------------------------------------------ */

const TIME_QUESTION = /^(?:jarvis[,\s]+)?(?:(?:dis[- ]moi\s+)?quelle heure (?:est[- ]il|il est)|il est quelle heure|tu as l['’]heure|l['’]heure(?: s['’]il te pla[iî]t)?)\s*[?!.]*$/iu;
const DATE_QUESTION = /^(?:jarvis[,\s]+)?(?:(?:dis[- ]moi\s+)?(?:quel jour (?:on est|sommes[- ]nous|est[- ]on|est[- ]ce)(?: aujourd['’]hui)?|on est quel jour(?: aujourd['’]hui)?|quelle est la date(?: d['’]aujourd['’]hui)?|c['’]est quoi la date(?: d['’]aujourd['’]hui)?))\s*[?!.]*$/iu;

/** « Quelle heure est-il ? », « On est quel jour ? » : réponse exacte depuis l'horloge, sans modèle. */
export function clockReply(text: string, now: Date, timeZone?: string): string | null {
  const question = text.trim();
  if (TIME_QUESTION.test(question)) {
    const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) })
      .format(now)
      .replace(':', ' h ');
    return `Il est ${time}.`;
  }
  if (DATE_QUESTION.test(question)) {
    const date = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...(timeZone ? { timeZone } : {}),
    }).format(now);
    return `Nous sommes le ${date}.`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 2. Chemin express : les règles existantes de Jarvis                 */
/* ------------------------------------------------------------------ */

export interface ExpressInput {
  text: string;
  history: readonly ChatMessage[];
  /** Équipes dont au moins un outil est enregistré (les équipes sans outil sont toujours là). */
  available: ReadonlySet<OrchestraTeam>;
  now?: Date;
}

/** Équipe désignée par une règle de Jarvis, sans modèle ; `null` : le cerveau décide. */
export function expressTeam(input: ExpressInput): OrchestraTeam | null {
  const text = input.text.trim();
  if (!text) return null;
  const pick = (team: OrchestraTeam) => (input.available.has(team) ? team : null);
  if (extractYoutubeUrl(text)) return pick('web');
  if (isMusicIntent(text) || isCurrentTrackQuestion(text)) return pick('musique');
  if (looksLikeGoogleIntent(text) || recentlyUsedGoogleTools([...input.history])) {
    const google = pick('google');
    if (google) return google;
  }
  if (extractSiteBlockIntent(text)) return pick('concentration');
  if (extractKnowledgeIntent(text)) return pick('memoire');
  if (detectCurrentInfoIntent(text, input.now ?? new Date()) || looksLikeWebResearchIntent(text)) return pick('web');
  return null;
}

/* ------------------------------------------------------------------ */
/* 3. Le cerveau choisit l'équipe                                      */
/* ------------------------------------------------------------------ */

export function routerSystemPrompt(available: readonly OrchestraTeam[]): string {
  return [
    'Tu es le chef d’orchestre de Jarvis, l’assistant de l’utilisateur sur son PC.',
    'Tu ne réponds jamais à la demande : tu choisis l’équipe qui va la traiter.',
    'Équipes :',
    ...available.map((team) => `- ${team} : ${TEAM_SPECS[team].description}`),
    'Réponds par un seul mot : le nom de l’équipe, sans rien d’autre.',
  ].join('\n');
}

/** Demande montrée au cerveau : les derniers échanges (pour « et ferme-le »), puis la demande. */
export function routerUserPrompt(text: string, history: readonly ChatMessage[]): string {
  const recent = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => message.content.trim())
    .slice(-4)
    .map((message) => {
      const content = message.content.replace(/\s+/g, ' ').trim();
      return `${message.role === 'user' ? 'Utilisateur' : 'Jarvis'} : ${content.length > 240 ? `${content.slice(0, 240)}…` : content}`;
    });
  return [recent.length ? `Conversation récente :\n${recent.join('\n')}\n` : '', `Demande : ${text.trim()}`, 'Équipe :']
    .filter(Boolean)
    .join('\n');
}

function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Premier nom d'équipe disponible dans la réponse du cerveau ; `null` si aucun. */
export function parseRouterReply(reply: string, available: readonly OrchestraTeam[]): OrchestraTeam | null {
  const words = plain(reply).match(/[a-z]+/g) ?? [];
  for (const word of words) {
    const team = available.find((candidate) => candidate === word);
    if (team) return team;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Configuration d'un tour                                             */
/* ------------------------------------------------------------------ */

/** Le cerveau reste chargé longtemps ; les autres modèles se libèrent plus vite. */
export const BRAIN_KEEP_ALIVE = '30m';
export const TEAM_KEEP_ALIVE = '10m';

/** Configuration du fournisseur pour un modèle de l'orchestre (Ollama seulement). */
export function orchestraProviderConfig(
  base: { model?: string; baseUrl?: string; apiKey?: string },
  model: string,
  place: ModelPlace,
  brain: boolean,
): ProviderConfig {
  return {
    provider: 'ollama',
    model,
    ...(base.baseUrl ? { baseUrl: base.baseUrl } : {}),
    ollama: {
      ...(place === 'processeur' ? { numGpu: 0 } : {}),
      keepAlive: brain ? BRAIN_KEEP_ALIVE : TEAM_KEEP_ALIVE,
      // Qwen3, 3.5, 3.6 : la « réflexion » ralentit sans rien apporter ici.
      ...(/^qwen3/i.test(model) ? { think: false } : {}),
      // Décision 5.0.60 : en mode orchestre, un appel d'outil écrit en texte est relu (petits modèles).
      recoverToolCalls: true,
    },
  };
}

/** Consigne de base courte. Une « Personnalité » modifiée par l'utilisateur est gardée telle quelle. */
export const ORCHESTRA_BASE_PROMPT = [
  'Tu es Jarvis, l’assistant personnel de l’utilisateur sur son PC Windows.',
  'Réponds en français, de façon naturelle, directe et concise.',
  'N’invente jamais un résultat d’outil, le contenu d’un fichier, un chiffre ni une action effectuée : si un outil ne l’a pas renvoyé, dis-le.',
  'Certaines actions demandent l’accord de l’utilisateur ; s’il refuse, accepte-le sans insister.',
].join(' ');

export function orchestraBasePrompt(settingsSystemPrompt: string): string {
  const custom = settingsSystemPrompt.trim();
  return custom && custom !== DEFAULT_SYSTEM_PROMPT.trim() ? custom : ORCHESTRA_BASE_PROMPT;
}

export function teamPrompt(team: OrchestraTeam): string {
  return `ÉQUIPE ${TEAM_SPECS[team].label.toUpperCase()} : ${TEAM_SPECS[team].prompt}`;
}

/** Équipes utilisables : sans outil, ou avec au moins un outil enregistré. */
export function availableTeams(toolNames: readonly string[]): OrchestraTeam[] {
  return ORCHESTRA_TEAMS.filter(
    (team) => TEAM_SPECS[team].tools.length === 0 || toolNames.some((name) => teamHasTool(team, name)),
  );
}

export interface OrchestraSettingsLike {
  enabled: boolean;
  brain: string;
  teams?: OrchestraConfig['teams'];
}

/** Orchestre actif : réglage allumé, cerveau renseigné, fournisseur Ollama. */
export function activeOrchestra(settings: {
  provider: string;
  orchestra?: OrchestraSettingsLike | undefined;
}): OrchestraConfig | null {
  const orchestra = settings.orchestra;
  if (!orchestra?.enabled || settings.provider !== 'ollama' || !orchestra.brain.trim()) return null;
  return { brain: orchestra.brain.trim(), teams: orchestra.teams ?? {} };
}

