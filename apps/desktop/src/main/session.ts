import type { WebContents } from 'electron';
import {
  Agent,
  buildAuditEntry,
  buildPersonalizationPrompt,
  createMessage,
  newConversation,
  randomId,
  withMessages,
  withSiteBlockPrompt,
  withKnowledgePrompt,
  withVoiceOriginNotice,
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
import type { PersonalizationStore } from './personalization.js';
import type { KnowledgeStore } from './knowledge.js';
import type { VoiceBridge } from './voice.js';

interface SessionDeps {
  registry: ProviderRegistry;
  tools: ToolManager;
  store: ConversationStore;
  auditLog: AuditLogStore;
  getSettings: () => Settings;
  voice: VoiceBridge;
  personalization: PersonalizationStore;
  knowledge: KnowledgeStore;
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
      voiceKeyConfigured: this.deps.voice.hasApiKey(),
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

    const emit = (event: ChatEvent): void => {
      if (!sender.isDestroyed()) sender.send(IpcChannel.chatEvent, event);
    };

    let conversationId = input.conversationId ?? '';
    const superseded = (): boolean =>
      controller.signal.aborted && this.controller !== null && this.controller !== controller;
    try {
    const settings = this.deps.getSettings();
    const conversation = await this.loadConversation(input.conversationId);
    conversationId = conversation.id;
    const userMessage = createMessage('user', input.text);
    const messages: ChatMessage[] = [...conversation.messages, userMessage];

    emit({ type: 'started', conversationId: conversation.id, message: userMessage });

    const { provider } = this.deps.registry.createOrFallback(settings);
    const agent = new Agent(provider, this.deps.tools, {
      // La note d'origine vocale ne vit que dans ce prompt système, transmis
      // au modèle pour ce tour : elle n'est jamais écrite dans `userMessage`
      // ni dans `messages`, donc jamais affichée ni persistée.
      systemPrompt: withKnowledgePrompt(
        withSiteBlockPrompt(
          withVoiceOriginNotice(settings.systemPrompt, input.source ?? 'text') +
            buildPersonalizationPrompt(await this.deps.personalization.get()),
        ),
      ),
      temperature: settings.temperature,
    });

    try {
      for await (const event of agent.run(messages, {
        signal: controller.signal,
        policies: settings.toolPolicies,
        debug: settings.debugLogging,
        requestConfirmation: (request) => this.askUser(sender, emit, request, controller.signal),
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
          case 'tool_progress':
            emit({ type: 'tool_progress', callId: event.callId, message: event.message });
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
      if (!superseded()) {
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (this.controller === controller) this.controller = null;
    }

    if (superseded()) return;

    const updated = withMessages(conversation, messages);
    try {
      await this.deps.store.save(updated);
    } catch (error) {
      // `done` doit partir quand même : sinon l'interface reste « Jarvis réfléchit… ».
      emit({
        type: 'error',
        message: `Conversation non enregistrée dans l'historique : ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    void this.deps.knowledge
      .indexConversation(
        `conversation:${updated.id}`,
        messages
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => `${message.role}: ${message.content}`)
          .join('\n'),
        settings,
      )
      .catch(() => undefined);
    emit({ type: 'done', conversationId: updated.id, messages: updated.messages });
    } catch {
      if (this.controller === controller) this.controller = null;
      if (superseded()) return;
      emit({
        type: 'error',
        message: "Le message n'a pas pu être envoyé. Réessaie dans un instant.",
      });
      emit({ type: 'done', conversationId, messages: [] });
    }
  }

  private askUser(
    sender: WebContents,
    emit: (event: ChatEvent) => void,
    request: ConfirmationRequest,
    signal: AbortSignal,
  ): Promise<boolean> {
    const requestId = randomId();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (approved: boolean): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        sender.removeListener?.('destroyed', onDestroyed);
        resolve(approved);
      };
      const onAbort = (): void => {
        this.pendingConfirmations.delete(requestId);
        settle(false);
      };
      const onDestroyed = (): void => {
        this.pendingConfirmations.delete(requestId);
        settle(false);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      sender.once?.('destroyed', onDestroyed);
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
