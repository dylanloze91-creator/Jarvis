/**
 * Équipe la plus utilisée, d'après les journaux de tour des conversations récentes.
 * Seuls les journaux sont lus (équipe, modèle) : jamais les messages.
 */
import { mostUsedTeam, turnLogsOf, type ConversationStore, type OrchestraTeam, type TurnLogEntry } from '@jarvis/core';

/** Conversations récentes regardées : assez pour voir l'usage, peu pour le démarrage. */
const RECENT_CONVERSATIONS = 60;

export async function mostUsedTeamOf(store: Pick<ConversationStore, 'list' | 'get'>): Promise<OrchestraTeam | null> {
  const summaries = [...(await store.list())].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_CONVERSATIONS);
  const entries: TurnLogEntry[] = [];
  for (const summary of summaries) {
    const conversation = await store.get(summary.id).catch(() => null);
    entries.push(...turnLogsOf(conversation));
  }
  return mostUsedTeam(entries);
}
