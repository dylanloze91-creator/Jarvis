import {
  deriveTitle,
  randomId,
  type ChatMessage,
  type Conversation,
  type ConversationSummary,
} from '../types.js';

/**
 * Persistance de l'historique. L'implémentation concrète dépend de la
 * plateforme (fichier JSON sur le bureau, stockage natif sur mobile), d'où
 * cette interface dans le cœur agnostique.
 */
export interface ConversationStore {
  list(): Promise<ConversationSummary[]>;
  get(id: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export function newConversation(messages: ChatMessage[] = []): Conversation {
  const now = Date.now();
  return {
    id: randomId(),
    title: deriveTitle(messages),
    createdAt: now,
    updatedAt: now,
    messages,
  };
}

export function withMessages(conversation: Conversation, messages: ChatMessage[]): Conversation {
  return {
    ...conversation,
    messages,
    title:
      conversation.title === 'Nouvelle conversation' ? deriveTitle(messages) : conversation.title,
    updatedAt: Date.now(),
  };
}

export function summarize(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
      .length,
  };
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  async list(): Promise<ConversationSummary[]> {
    return [...this.conversations.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summarize);
  }

  async get(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async save(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, conversation);
  }

  async remove(id: string): Promise<void> {
    this.conversations.delete(id);
  }

  async clear(): Promise<void> {
    this.conversations.clear();
  }
}
