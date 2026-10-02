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

/** Mesures d'Ollama en fin de réponse (modèle de code seulement). Durées en millisecondes. */
export interface ChatUsage {
  promptTokens: number;
  promptMs: number;
  outputTokens: number;
  outputMs: number;
  loadMs: number;
  totalMs: number;
}

export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; finishReason: FinishReason; usage?: ChatUsage }
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
  /** Réglages de requête du modèle de code (Jarvis Développeur). Absents : requête du chat inchangée. */
  ollama?: OllamaCodeOptions;
}

/** Options de requête Ollama, jamais des variables du serveur. */
export interface OllamaCodeOptions {
  numCtx?: number;
  /** Couches sur la carte graphique (`num_gpu`) : 0 = tout sur le processeur, 99 = tout ce qui peut aller sur la carte. */
  numGpu?: number;
  numThread?: number;
  /** `false` coupe la « réflexion » des modèles qui la gèrent (Qwen3.5, Qwen3.6) ; absent = non envoyé. */
  think?: boolean;
  keepAlive?: string | number;
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
