export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallOutcome {
  callId: string;
  name: string;
  status: 'ok' | 'error' | 'denied';
  content: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** Présent sur les messages `assistant` qui demandent l'exécution d'outils. */
  toolCalls?: ToolCall[];
  /** Présent sur les messages `tool`, référence l'appel auquel ils répondent. */
  toolCallId?: string;
  toolName?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
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
