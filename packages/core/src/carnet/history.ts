/**
 * Tour précédent dans une discussion déjà enregistrée.
 * Sert au signal « ça n'a pas marché » : on note ce tour-là, pas la phrase du signal.
 */
import type { ChatMessage } from '../types.js';
import type { PreviousTurn, ToolLine } from './types.js';

export function previousFromHistory(messages: readonly ChatMessage[]): PreviousTurn | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const reply = messages[i];
    if (!reply || reply.role !== 'assistant' || !reply.content.trim()) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      const user = messages[j];
      if (!user || user.role !== 'user' || !user.content.trim()) continue;
      const tools: ToolLine[] = [];
      for (const message of messages.slice(j + 1, i)) {
        if (message.role !== 'tool') continue;
        tools.push({
          name: message.toolName ?? 'outil',
          status: message.toolStatus ?? 'ok',
          line: message.content.replace(/\s+/g, ' ').trim(),
        });
      }
      return {
        at: user.createdAt,
        userText: user.content,
        replyText: reply.content,
        team: null,
        model: null,
        how: null,
        tools,
        durations: {},
      };
    }
    return null;
  }
  return null;
}
