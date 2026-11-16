/**
 * Journal du tour (Jarvis Test seulement).
 * Même interrupteur que l'édition : `JARVIS_EDITION=test`, ou `jarvisEdition: "test"`
 * écrit dans le package.json au moment de construire l'installateur de Test.
 * Rien de cela : Jarvis Live, et le fichier de conversation ne gagne aucun champ.
 */
import { createRequire } from 'node:module';
import type { Conversation, TurnLogEntry } from '@jarvis/core';

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

export function editionCuite(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { jarvisEdition?: unknown };
    return typeof pkg.jarvisEdition === 'string' ? pkg.jarvisEdition : undefined;
  } catch {
    return undefined;
  }
}

/** Vrai seulement dans Jarvis Test. Live (défaut) ne note rien. */
export function editionTest(env: NodeJS.ProcessEnv = process.env, baked = editionCuite()): boolean {
  if (env.JARVIS_EDITION === 'test') return true;
  if (env.JARVIS_EDITION === 'live') return false;
  return baked === 'test';
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
    directMission: boolean;
    chatProviderId: string;
    chatModel: string | null;
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

  if (input.health) {
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
  };

  const turnLog = [...(conversation.turnLog ?? []), entry];
  const routeLog = [...(conversation.routeLog ?? [])];
  if (team) routeLog.push({ userMessageId: user.id, team, ...(how ? { how } : {}) });

  return { ...conversation, turnLog, ...(routeLog.length ? { routeLog } : {}) };
}
