import type { AtelierEtat } from './atelier/discussion.js';
import type { ToolCategory } from './tools/types.js';
import type { ChatMissionEnvelope } from './developer/chatMissions/envelope.js';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Comment l'exécution a-t-elle été autorisée ?
 * - `auto`     : outil `safe`, aucune confirmation n'était nécessaire.
 * - `approved` : outil `confirm`, l'utilisateur a accepté.
 * - `refused`  : outil `confirm`, l'utilisateur a refusé.
 * - `blocked`  : outil `denied` ou inconnu, jamais soumis à l'utilisateur.
 */
export type ToolDecision = 'auto' | 'approved' | 'refused' | 'blocked';

export interface ToolCallOutcome {
  callId: string;
  name: string;
  status: 'ok' | 'error' | 'denied';
  content: string;
  /** Arguments exacts transmis à l'outil, pour le journal d'audit. */
  arguments: Record<string, unknown>;
  decision: ToolDecision;
  /** Durée d'exécution en millisecondes, confirmation utilisateur comprise. */
  durationMs: number;
  category?: ToolCategory;
  /**
   * Classification additive (§23). Absente sur les anciens résultats :
   * `ok` → succès, `error` → définitif, `denied` → annulation ou blocage.
   */
  outcome?:
    | 'success'
    | 'recoverable'
    | 'definitive'
    | 'timeout'
    | 'cancelled'
    | 'missing_dependency';
  /** Détail technique déjà rédigé, réservé au journal. */
  technicalDetail?: string;
  /** Charge utile structurée de l'outil (`ToolResult.data`), jamais envoyée au modèle ni au journal. */
  data?: unknown;
  /** Résultat repris de la mémoire courte des outils, avec son âge. Absent : l'outil a travaillé. */
  kept?: { ageMs: number };
}

/**
 * Module images : une photo jointe par l'utilisateur à son message, enregistrée sur le
 * disque par le processus principal (jamais envoyée au modèle de langage : seul son chemin
 * lui est dit, pour l'outil `generer_image`).
 */
export interface ChatAttachment {
  /** Nom d'origine du fichier (affiché). */
  name: string;
  /** Chemin de la copie faite par Jarvis (dossier des images, sous `_references`). */
  path: string;
  mime: string;
  kind: 'image';
}

/** Photo des yeux de Jarvis rattachée à une réponse (l'image reste en mémoire dans le PC). */
export interface PhotoDiscussion {
  photoId: string;
  prisA: number;
  camera: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** Images jointes (base64 brut, API Ollama). */
  images?: string[];
  /** Photos jointes par l'utilisateur (module images). */
  attachments?: ChatAttachment[];
  /** Présent sur les messages `assistant` qui demandent l'exécution d'outils. */
  toolCalls?: ToolCall[];
  /** Présent sur les messages `tool`, référence l'appel auquel ils répondent. */
  toolCallId?: string;
  toolName?: string;
  /** Présent sur les messages `tool` : un refus ne doit pas se relire « terminé » dans l'historique. */
  toolStatus?: ToolCallOutcome['status'];
  /** 5.0.68 — carte mission, suivi ou rapport dans la discussion unifiée. */
  chatMission?: ChatMissionEnvelope;
  /** Mission Jarvis Développeur rattachée à ce message (historique). */
  missionId?: string;
  /** Mode direct de Jarvis Imager (`/image`, règles) : ce tour n'est jamais renvoyé au modèle de langage. */
  direct?: 'image';
  /** Message utilisateur direct : la consigne réellement confiée à Imager (sert aux suites « la même en anime »). */
  directPrompt?: string;
  /** Atelier 3D (Jarvis Test) : question en cours, ou pièce rendue avec ses versions (écran 3D). */
  atelier?: AtelierEtat;
  /**
   * Les yeux de Jarvis (Jarvis Test) : une photo de la caméra de l'imprimante sous la réponse.
   * Seulement sa référence et son heure : l'image vit en mémoire, jamais dans l'historique.
   */
  yeux?: PhotoDiscussion;
  createdAt: number;
}

/**
 * Équipe choisie pour un message utilisateur. Facultatif : les anciennes
 * conversations n'ont pas ce journal. Aucun défaut Zod.
 */
export interface RouteLogEntry {
  userMessageId: string;
  team: string;
  how?: string;
}

/** Outil vu pendant un tour, tel que le journal le note. */
export interface TurnLogTool {
  name: string;
  status: string;
}

/**
 * Journal d'un tour, écrit à la fin du tour dans Jarvis Test seulement.
 * Absent des anciennes conversations et de Jarvis Live. Aucun défaut Zod.
 */
export interface TurnLogEntry {
  userMessageId: string;
  /** Réponse(s) et messages d'outil de ce tour. */
  assistantMessageIds: string[];
  /** Équipe du chef d'orchestre. `null` : chat d'avant. */
  team: string | null;
  /** calcul, horloge, express, trieur, cerveau, ou `null`. */
  how: string | null;
  /** ollama, openai, anthropic, mock, ou aucun (sans modèle). */
  provider: string;
  /** ex. qwen2.5:7b ; `null` si aucun modèle. */
  model: string | null;
  place: 'carte' | 'processeur' | null;
  source: 'texte' | 'voix' | 'telephone' | 'enceinte';
  tools: TurnLogTool[];
  durationMs: number;
  at: number;
  /** Chronomètre par étape. Absent des journaux écrits avant lui. */
  etapes?: TurnSteps;
}

/**
 * Détail d'un tour, en millisecondes (mission « Jarvis plus rapide, sans nouveau modèle »).
 * Que des durées, des comptes et des noms d'outil : jamais une phrase. Chaque champ est
 * facultatif : il manque quand l'étape n'a pas eu lieu ou n'a pas pu être mesurée.
 */
export interface TurnSteps {
  /** Choix de l'équipe. `modele` : un modèle a été appelé pour trier (cerveau ou trieur). */
  tri?: { ms: number; chemin: string; modele?: boolean; chargementMs?: number; jetons?: number };
  /** Chargement du modèle qui répond (`load_duration` d'Ollama, tous ses appels du tour). */
  chargement?: number;
  /** Lecture du prompt (`prompt_eval_duration`, `prompt_eval_count`). */
  lecture?: { ms: number; jetons: number };
  /** Du début du tour au premier morceau de réponse affiché. */
  premierMot?: number;
  /** Écriture de la réponse (`eval_duration`, `eval_count`). */
  ecriture?: { ms: number; jetons: number };
  /** Nombre d'appels au modèle qui répond (1, plus un par tour d'outils). */
  appels?: number;
  /** Temps passé dans chaque outil. `garde` : résultat repris de la mémoire courte. */
  outils?: { name: string; ms: number; garde?: boolean }[];
  /** Du début du tour au premier son, quand la réponse est dite. */
  voix?: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** Journal des équipes. Absent tant qu'aucun tour ne l'a rempli. */
  routeLog?: RouteLogEntry[];
  /** Journal des tours. Absent dans Live et dans les anciennes conversations. */
  turnLog?: TurnLogEntry[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export function createMessage(
  role: MessageRole,
  content: string,
  extra: Partial<Omit<ChatMessage, 'id' | 'role' | 'content' | 'createdAt'>> = {},
): ChatMessage {
  return { id: randomId(), role, content, createdAt: Date.now(), ...extra };
}

export function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Titre dérivé du premier message utilisateur, utilisé dans la liste d'historique. */
export function deriveTitle(messages: ChatMessage[], fallback = 'Nouvelle conversation'): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim().length > 0);
  if (!first) return fallback;
  const oneLine = first.content.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}
