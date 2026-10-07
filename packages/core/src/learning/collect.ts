import type { ChatMessage } from '../types.js';
import type { LocalLearningExample } from './types.js';

const CORRECTION_PREFIX = /^(non|pas ça|corrige|plutôt|je voulais|erreur|tu as tort|refais)/i;

export function shouldTreatAsCorrection(userText: string): boolean {
  const t = userText.trim();
  return t.length >= 4 && CORRECTION_PREFIX.test(t);
}

/** Extrait un exemple apprentissable depuis les messages finaux d’un tour. */
export function exampleFromTurn(input: {
  conversationId: string;
  messages: ChatMessage[];
  idFactory: () => string;
}): { example: LocalLearningExample | null; markPreviousCorrection?: string } {
  const users = input.messages.filter((m) => m.role === 'user');
  const assistants = input.messages.filter((m) => m.role === 'assistant');
  if (users.length === 0 || assistants.length === 0) return { example: null };

  const lastUser = users[users.length - 1]!;
  const lastAssistant = assistants[assistants.length - 1]!;
  const userText = lastUser.content.trim();
  const assistantText = lastAssistant.content.trim();
  if (userText.length < 2 || assistantText.length < 2) return { example: null };

  if (users.length >= 2 && shouldTreatAsCorrection(userText)) {
    const prevUser = users[users.length - 2]!;
    const prevAssistant = assistants.length >= 2 ? assistants[assistants.length - 2] : null;
    if (prevAssistant) {
      return {
        example: {
          id: input.idFactory(),
          at: Date.now(),
          user: prevUser.content.trim(),
          assistant: prevAssistant.content.trim(),
          correction: userText,
          toolsOk: toolNamesOk(input.messages),
          conversationId: input.conversationId,
        },
        markPreviousCorrection: userText,
      };
    }
  }

  return {
    example: {
      id: input.idFactory(),
      at: Date.now(),
      user: userText,
      assistant: assistantText,
      toolsOk: toolNamesOk(input.messages),
      conversationId: input.conversationId,
    },
  };
}

function toolNamesOk(messages: ChatMessage[]): string[] {
  const names: string[] = [];
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const ok = !/échec|error|refus/i.test(message.content);
    if (ok && message.toolName) names.push(message.toolName);
  }
  return [...new Set(names)];
}
