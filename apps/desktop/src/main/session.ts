import type { WebContents } from 'electron';
import {
  Agent,
  buildAuditEntry,
  createMessage,
  newConversation,
  randomId,
  withMessages,
  type AuditLogStore,
  type ChatMessage,
  type ConfirmationRequest,
  type Conversation,
  type ConversationStore,
  type ProviderRegistry,
  type Settings,
  type ToolManager,
} from '@jarvis/core';
import type { ChatEvent, RuntimeStatus, SendChatInput } from '../shared/ipc.js';
import { IpcChannel } from '../shared/ipc.js';

interface SessionDeps {
  registry: ProviderRegistry;
  tools: ToolManager;
  store: ConversationStore;
  auditLog: AuditLogStore;
  getSettings: () => Settings;
}

/**
 * Fait le pont entre l'agent (dans `@jarvis/core`) et l'interface : un tour de
 * conversation, ses événements de streaming, ses demandes de confirmation et
 * la persistance du résultat.
 */
export class ChatSession {
  private readonly pendingConfirmations = new Map<string, (approved: boolean) => void>();
  private controller: AbortController | null = null;

  constructor(private readonly deps: SessionDeps) {}

  status(): RuntimeStatus {
    const settings = this.deps.getSettings();
    const { provider, fellBack } = this.deps.registry.createOrFallback(settings);
    return {
      providerId: provider.id,
      providerLabel: provider.label,
      model: provider.model,
      usingFallback: fellBack,
    };
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    for (const resolve of this.pendingConfirmations.values()) resolve(false);
    this.pendingConfirmations.clear();
  }

  respondConfirmation(requestId: string, approved: boolean): void {
    const resolve = this.pendingConfirmations.get(requestId);
    if (!resolve) return;
    this.pendingConfirmations.delete(requestId);
    resolve(approved);
  }

  async send(sender: WebContents, input: SendChatInput): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;

    const settings = this.deps.getSettings();
    const conversation = await this.loadConversation(input.conversationId);
    const userMessage = createMessage('user', input.text);
    const messages: ChatMessage[] = [...conversation.messages, userMessage];

    const emit = (event: ChatEvent): void => {
      if (!sender.isDestroyed()) sender.send(IpcChannel.chatEvent, event);
    };

    emit({ type: 'started', conversationId: conversation.id, message: userMessage });

    const { provider } = this.deps.registry.createOrFallback(settings);
    const agent = new Agent(provider, this.deps.tools, {
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
    });

    try {
      for await (const event of agent.run(messages, {
        signal: controller.signal,
        policies: settings.toolPolicies,
        requestConfirmation: (request) => this.askUser(emit, request, controller.signal),
      })) {
        switch (event.type) {
          case 'assistant_delta':
            emit({ type: 'delta', text: event.delta });
            break;
          case 'assistant_message':
            messages.push(event.message);
            break;
          case 'tool_start':
            emit({ type: 'tool_start', callId: event.call.id, toolName: event.call.name });
            break;
          case 'tool_result':
            messages.push(event.message);
            emit({
              type: 'tool_result',
              callId: event.outcome.callId,
              toolName: event.outcome.name,
              status: event.outcome.status,
              content: event.outcome.content,
            });
            void this.deps.auditLog.append(buildAuditEntry(event.outcome));
            break;
          case 'error':
            emit({ type: 'error', message: event.message });
            break;
          case 'done':
            break;
        }
      }
    } catch (error) {
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.controller === controller) this.controller = null;
    }

    const updated = withMessages(conversation, messages);
    await this.deps.store.save(updated);
    emit({ type: 'done', conversationId: updated.id, messages: updated.messages });
  }

  private askUser(
    emit: (event: ChatEvent) => void,
    request: ConfirmationRequest,
    signal: AbortSignal,
  ): Promise<boolean> {
    const requestId = randomId();
    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean): void => {
        signal.removeEventListener('abort', onAbort);
        resolve(approved);
      };
      const onAbort = (): void => {
        this.pendingConfirmations.delete(requestId);
        settle(false);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      this.pendingConfirmations.set(requestId, settle);
      emit({
        type: 'confirm',
        requestId,
        toolName: request.toolName,
        details: request.details,
        command: request.command,
        forced: request.forced,
      });
    });
  }

  private async loadConversation(id: string | null): Promise<Conversation> {
    if (!id) return newConversation();
    return (await this.deps.store.get(id)) ?? newConversation();
  }
}
