import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
  ProviderDescriptor,
  RiskLevel,
  Settings,
} from '@jarvis/core';

export const IpcChannel = {
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',
  confirmRespond: 'chat:confirm-respond',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsProviders: 'settings:providers',
  historyList: 'history:list',
  historyGet: 'history:get',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',
  toolsList: 'tools:list',
  windowHide: 'window:hide',
  windowResize: 'window:resize',
} as const;

export interface SendChatInput {
  conversationId: string | null;
  text: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  risk: RiskLevel;
}

/** Événements poussés du processus principal vers l'interface pendant un tour. */
export type ChatEvent =
  | { type: 'started'; conversationId: string; message: ChatMessage }
  | { type: 'delta'; text: string }
  | { type: 'confirm'; requestId: string; toolName: string; details: string }
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
}

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
  window: {
    hide(): Promise<void>;
    resize(height: number): Promise<void>;
  };
}
