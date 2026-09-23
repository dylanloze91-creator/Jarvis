import type { ChatMessage, ToolCall } from '../types.js';

/** Description d'un outil telle qu'elle est exposée au modèle. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  system?: string;
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; finishReason: FinishReason }
  | { type: 'error'; message: string };

/**
 * Contrat que tout fournisseur de modèle doit respecter. Le reste de
 * l'application ne connaît que cette interface : ajouter un modèle revient à
 * écrire une implémentation et à l'enregistrer dans le registre.
 */
export interface LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  /** Un provider sans clé (le mock) reste utilisable hors ligne. */
  readonly requiresApiKey: boolean;
  streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ProviderDescriptor {
  id: string;
  label: string;
  requiresApiKey: boolean;
  defaultModel: string;
  suggestedModels: string[];
  /** Renseigné pour les backends compatibles OpenAI (Ollama, LM Studio, vLLM…). */
  defaultBaseUrl?: string;
}

export type ProviderFactory = (config: ProviderConfig) => LLMProvider;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
