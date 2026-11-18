/**
 * Journal du tour (Jarvis Test seulement).
 * L'édition vient de la table d'édition (`packages/core/src/edition.ts`, lue par `edition()`),
 * comme partout ailleurs : pas de seconde façon de savoir « Test ou Live ».
 * Live : le fichier de conversation ne gagne aucun champ.
 */
import { emptySteps, type Conversation, type TurnLogEntry, type TurnSteps } from '@jarvis/core';
import { edition } from './edition.js';

export interface LieuTour {
  kind: 'fenetre' | 'telephone' | 'enceinte';
  name?: string;
}

export interface RouteNotee {
  team: string;
  how: string;
  providerId: string | null;
  model: string | null;
  place: 'carte' | 'processeur' | null;
  /** Réponse déjà prête : aucun modèle n'a parlé. */
  sansModele: boolean;
}

/** Vrai seulement dans Jarvis Test (table d'édition). Live (défaut) ne note rien. */
export function editionTest(): boolean {
  return edition().id === 'test';
}

export function sourceDuTour(input: {
  source?: 'voice' | 'text';
  place?: LieuTour;
}): TurnLogEntry['source'] {
  if (input.place?.kind === 'enceinte') return 'enceinte';
  if (input.place?.kind === 'telephone') return 'telephone';
  if (input.source === 'voice') return 'voix';
  return 'texte';
}

function fournisseur(id: string | null | undefined): string {
  const value = (id ?? '').trim().toLowerCase();
  if (value === 'ollama' || value === 'openai' || value === 'anthropic' || value === 'mock') return value;
  return 'aucun';
}

/**
 * Ajoute `turnLog` et `routeLog` sur la conversation déjà complétée.
 * Hors Jarvis Test, la conversation est rendue telle quelle.
 */
export function journaliserTour(
  conversation: Conversation,
  input: {
    startedAt: number;
    previousCount: number;
    source?: 'voice' | 'text';
    place?: LieuTour;
    route: RouteNotee | null;
    health: boolean;
    /**
     * Réponse fixe du quotidien (briefing, notes, routines, imprimante) : écrite par le code de
     * Jarvis, jamais par un modèle. Notée `aucun`, sinon le jeu de réponses l'attribuerait au
     * modèle du chat.
     */
    fixedReply?: boolean;
    directMission: boolean;
    chatProviderId: string;
    chatModel: string | null;
    /** Chronomètre par étape. Absent ou vide : la ligne du journal est celle d'avant. */
    etapes?: TurnSteps;
    now?: number;
  },
): Conversation {
  if (!editionTest()) return conversation;
  const fresh = conversation.messages.slice(input.previousCount);
  const user = fresh.find((message) => message.role === 'user');
  if (!user) return conversation;

  let team: string | null = null;
  let how: string | null = null;
  let provider = 'aucun';
  let model: string | null = null;
  let place: TurnLogEntry['place'] = null;

  if (input.health || input.fixedReply) {
    team = null;
    how = null;
    provider = 'aucun';
  } else if (input.directMission) {
    team = input.route?.team ?? null;
    how = 'mission-directe';
    provider = 'aucun';
  } else if (input.route?.sansModele) {
    team = input.route.team;
    how = input.route.team === 'horloge' ? 'horloge' : input.route.how;
    provider = 'aucun';
  } else if (input.route && !input.route.sansModele) {
    team = input.route.team;
    how = input.route.team === 'horloge' ? 'horloge' : input.route.how;
    provider = fournisseur(input.route.providerId);
    model = input.route.model?.trim() ? input.route.model.trim() : null;
    place = input.route.place;
  } else {
    provider = fournisseur(input.chatProviderId);
    model = input.chatModel?.trim() ? input.chatModel.trim() : null;
  }

  const entry: TurnLogEntry = {
    userMessageId: user.id,
    assistantMessageIds: fresh
      .filter((message) => message.role === 'assistant' || message.role === 'tool')
      .map((message) => message.id),
    team,
    how,
    provider,
    model,
    place,
    source: sourceDuTour(input),
    tools: fresh
      .filter((message) => message.role === 'tool' && message.toolName)
      .map((message) => ({ name: message.toolName ?? '', status: message.toolStatus ?? 'inconnu' })),
    durationMs: Math.max(0, (input.now ?? Date.now()) - input.startedAt),
    at: user.createdAt,
    ...(input.etapes && !emptySteps(input.etapes) ? { etapes: input.etapes } : {}),
  };

  const turnLog = [...(conversation.turnLog ?? []), entry];
  const routeLog = [...(conversation.routeLog ?? [])];
  if (team) routeLog.push({ userMessageId: user.id, team, ...(how ? { how } : {}) });

  return { ...conversation, turnLog, ...(routeLog.length ? { routeLog } : {}) };
}
