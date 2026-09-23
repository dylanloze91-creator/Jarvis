import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, Conversation } from '@jarvis/core';
import type { ChatEvent } from '../../../shared/ipc';

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: string;
      name: string;
      status: 'running' | 'ok' | 'error' | 'denied';
      content: string;
    }
  | { kind: 'error'; id: string; text: string };

export interface PendingConfirmation {
  requestId: string;
  toolName: string;
  details: string;
}

let localId = 0;
const nextId = (): string => `local-${(localId += 1)}`;

export interface UseChatOptions {
  /** Appelé avec le texte final de l'assistant à chaque tour, pour la réponse vocale. */
  onAssistantFinal?: (text: string) => void;
}

export function useChat(options: UseChatOptions = {}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const onAssistantFinal = useRef(options.onAssistantFinal);
  onAssistantFinal.current = options.onAssistantFinal;

  useEffect(() => {
    return window.jarvis.chat.onEvent((event: ChatEvent) => {
      switch (event.type) {
        case 'started': {
          setConversationId(event.conversationId);
          setItems((current) => [
            ...closeStreaming(current),
            { kind: 'user', id: event.message.id, text: event.message.content },
          ]);
          break;
        }
        case 'delta': {
          const id = nextId();
          setItems((current) => appendDelta(current, id, event.text));
          break;
        }
        case 'tool_start': {
          setItems((current) => [
            ...closeStreaming(current),
            {
              kind: 'tool',
              id: event.callId,
              name: event.toolName,
              status: 'running',
              content: '',
            },
          ]);
          break;
        }
        case 'tool_result': {
          setItems((current) =>
            current.map((item) =>
              item.kind === 'tool' && item.id === event.callId
                ? { ...item, status: event.status, content: event.content }
                : item,
            ),
          );
          break;
        }
        case 'confirm': {
          setConfirmation({
            requestId: event.requestId,
            toolName: event.toolName,
            details: event.details,
          });
          break;
        }
        case 'error': {
          setItems((current) => [...current, { kind: 'error', id: nextId(), text: event.message }]);
          break;
        }
        case 'done': {
          setConfirmation(null);
          setBusy(false);
          setConversationId(event.conversationId);
          setItems(closeStreaming);
          const lastAssistant = [...event.messages]
            .reverse()
            .find((message) => message.role === 'assistant' && message.content.trim().length > 0);
          if (lastAssistant) onAssistantFinal.current?.(lastAssistant.content);
          break;
        }
      }
    });
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || busy) return;
      setBusy(true);
      void window.jarvis.chat.send({ conversationId, text: trimmed });
    },
    [busy, conversationId],
  );

  const cancel = useCallback(() => {
    void window.jarvis.chat.cancel();
    setConfirmation(null);
    setBusy(false);
  }, []);

  const respond = useCallback((requestId: string, approved: boolean) => {
    setConfirmation(null);
    void window.jarvis.chat.respondConfirmation(requestId, approved);
  }, []);

  const reset = useCallback(() => {
    setItems([]);
    setConversationId(null);
    setConfirmation(null);
  }, []);

  const load = useCallback((conversation: Conversation) => {
    setItems(toItems(conversation.messages));
    setConversationId(conversation.id);
    setConfirmation(null);
  }, []);

  return { items, busy, confirmation, conversationId, send, cancel, respond, reset, load };
}

/**
 * Le texte s'accumule dans la dernière bulle tant qu'elle est en cours. Un
 * appel d'outil la referme, si bien que la suite de la réponse s'affiche dans
 * une nouvelle bulle, après le résultat de l'outil.
 */
function appendDelta(current: ChatItem[], id: string, text: string): ChatItem[] {
  const last = current.at(-1);
  if (last?.kind === 'assistant' && last.streaming) {
    return [...current.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...current, { kind: 'assistant', id, text, streaming: true }];
}

function closeStreaming(items: ChatItem[]): ChatItem[] {
  return items.map((item) =>
    item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
  );
}

function toItems(messages: ChatMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      items.push({ kind: 'user', id: message.id, text: message.content });
    } else if (message.role === 'assistant' && message.content.trim().length > 0) {
      items.push({ kind: 'assistant', id: message.id, text: message.content, streaming: false });
    } else if (message.role === 'tool') {
      items.push({
        kind: 'tool',
        id: message.id,
        name: message.toolName ?? 'outil',
        status: 'ok',
        content: message.content,
      });
    }
  }
  return items;
}
