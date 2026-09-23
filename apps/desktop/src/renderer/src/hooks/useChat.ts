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

export function useChat() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  /** Une réponse reprise après un outil doit s'afficher dans une nouvelle bulle. */
  const openBubble = useRef<string | null>(null);

  useEffect(() => {
    return window.jarvis.chat.onEvent((event: ChatEvent) => {
      switch (event.type) {
        case 'started': {
          setConversationId(event.conversationId);
          openBubble.current = null;
          setItems((current) => [
            ...current,
            { kind: 'user', id: event.message.id, text: event.message.content },
          ]);
          break;
        }
        case 'delta': {
          setItems((current) => appendDelta(current, openBubble, event.text));
          break;
        }
        case 'tool_start': {
          openBubble.current = null;
          setItems((current) => [
            ...current,
            { kind: 'tool', id: event.callId, name: event.toolName, status: 'running', content: '' },
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
          openBubble.current = null;
          setConfirmation(null);
          setBusy(false);
          setConversationId(event.conversationId);
          setItems((current) =>
            current.map((item) =>
              item.kind === 'assistant' ? { ...item, streaming: false } : item,
            ),
          );
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
    openBubble.current = null;
  }, []);

  const load = useCallback((conversation: Conversation) => {
    setItems(toItems(conversation.messages));
    setConversationId(conversation.id);
    setConfirmation(null);
    openBubble.current = null;
  }, []);

  return { items, busy, confirmation, conversationId, send, cancel, respond, reset, load };
}

function appendDelta(
  current: ChatItem[],
  openBubble: { current: string | null },
  text: string,
): ChatItem[] {
  if (openBubble.current) {
    return current.map((item) =>
      item.kind === 'assistant' && item.id === openBubble.current
        ? { ...item, text: item.text + text }
        : item,
    );
  }

  const id = nextId();
  openBubble.current = id;
  return [...current, { kind: 'assistant', id, text, streaming: true }];
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
