import type {
  AuditEntry,
  ChatMessage,
  Conversation,
  ConversationSummary,
  MarketDataProviderDescriptor,
  OllamaDiagnosticResult,
  OllamaStatusResult,
  ProviderDescriptor,
  RiskLevel,
  SearchProviderDescriptor,
  Settings,
  ToolCategory,
} from '@jarvis/core';

export const IpcChannel = {
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',
  confirmRespond: 'chat:confirm-respond',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsProviders: 'settings:providers',
  settingsSearchProviders: 'settings:search-providers',
  settingsMarketDataProviders: 'settings:market-data-providers',
  settingsOllamaStatus: 'settings:ollama-status',
  settingsOllamaTest: 'settings:ollama-test',
  historyList: 'history:list',
  historyGet: 'history:get',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',
  toolsList: 'tools:list',
  auditList: 'audit:list',
  auditClear: 'audit:clear',
  windowHide: 'window:hide',
  windowResize: 'window:resize',
  voiceTranscribe: 'voice:transcribe',
  voiceSpeak: 'voice:speak',
} as const;

export interface SendChatInput {
  conversationId: string | null;
  text: string;
  /**
   * Origine du message : `voice` pour la reconnaissance vocale, `text` pour
   * le clavier (défaut). Sert uniquement à avertir le modèle, dans le prompt
   * système, que le texte peut contenir des erreurs de transcription — ne
   * touche jamais le contenu affiché ni celui persisté dans l'historique.
   */
  source?: 'voice' | 'text';
}

export interface ToolInfo {
  name: string;
  description: string;
  risk: RiskLevel;
  category?: ToolCategory;
  forceConfirm: boolean;
}

/** Événements poussés du processus principal vers l'interface pendant un tour. */
export type ChatEvent =
  | { type: 'started'; conversationId: string; message: ChatMessage }
  | { type: 'delta'; text: string }
  | {
      type: 'confirm';
      requestId: string;
      toolName: string;
      details: string;
      /** Commande ou action exacte à afficher telle quelle (obligatoire pour `run_command`). */
      command?: string;
      /** Confirmation incompressible : l'interface le signale distinctement. */
      forced?: boolean;
    }
  | { type: 'tool_start'; callId: string; toolName: string }
  | {
      type: 'tool_result';
      callId: string;
      toolName: string;
      status: 'ok' | 'error' | 'denied';
      content: string;
    }
  | { type: 'error'; message: string }
  | { type: 'done'; conversationId: string; messages: ChatMessage[] };

export interface RuntimeStatus {
  providerId: string;
  providerLabel: string;
  model: string;
  usingFallback: boolean;
  /** Vrai si une clé OpenAI est configurée pour la voix (jamais transmise elle-même au renderer). */
  voiceKeyConfigured: boolean;
}

/**
 * Requêtes vocales qui doivent obligatoirement passer par le processus
 * principal : ce sont les seules à impliquer une clé API, qui ne doit
 * jamais atteindre le renderer. Tout le reste de la voix (capture micro,
 * détection du mot de réveil, reconnaissance et synthèse locales) se passe
 * entièrement dans le renderer, sans IPC.
 */
export interface VoiceTranscribeInput {
  /** PCM mono, amplitude normalisée [-1, 1]. */
  pcm: Float32Array;
  sampleRate: number;
  language?: string;
}

export type VoiceTranscribeResult = { ok: true; text: string } | { ok: false; error: string };

export interface VoiceSpeakInput {
  text: string;
  voice?: string;
}

export type VoiceSpeakResult =
  { ok: true; data: Uint8Array; mimeType: string } | { ok: false; error: string };

export interface JarvisApi {
  chat: {
    send(input: SendChatInput): Promise<void>;
    cancel(): Promise<void>;
    onEvent(listener: (event: ChatEvent) => void): () => void;
    respondConfirmation(requestId: string, approved: boolean): Promise<void>;
  };
  settings: {
    get(): Promise<{ settings: Settings; status: RuntimeStatus }>;
    set(patch: Partial<Settings>): Promise<{ settings: Settings; status: RuntimeStatus }>;
    providers(): Promise<ProviderDescriptor[]>;
    searchProviders(): Promise<SearchProviderDescriptor[]>;
    marketDataProviders(): Promise<MarketDataProviderDescriptor[]>;
    /** Sonde le serveur Ollama local (détecté / absent / injoignable) et liste ses modèles installés. */
    ollamaStatus(baseUrl?: string): Promise<OllamaStatusResult>;
    /** Test de connexion complet : serveur, modèle installé, puis appel d'outil réel. */
    ollamaTest(input: { baseUrl?: string; model: string }): Promise<OllamaDiagnosticResult>;
  };
  history: {
    list(): Promise<ConversationSummary[]>;
    get(id: string): Promise<Conversation | null>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
  };
  tools: {
    list(): Promise<ToolInfo[]>;
  };
  audit: {
    list(limit?: number): Promise<AuditEntry[]>;
    clear(): Promise<void>;
  };
  window: {
    hide(): Promise<void>;
    resize(height: number): Promise<void>;
  };
  voice: {
    transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult>;
    speak(input: VoiceSpeakInput): Promise<VoiceSpeakResult>;
  };
}
