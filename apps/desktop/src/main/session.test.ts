import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryAuditLogStore,
  InMemoryConversationStore,
  createDefaultRegistry,
  defineTool,
  emptyPersonalization,
  parseSettings,
  ToolManager,
} from '@jarvis/core';
import { z } from 'zod';
import type { ChatEvent } from '../shared/ipc.js';
import { ChatSession } from './session.js';

function sender(events: ChatEvent[]) {
  return {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
}

function session(options: { save?: () => Promise<void> } = {}) {
  const store = new InMemoryConversationStore();
  if (options.save) store.save = options.save;
  const executed = vi.fn(async () => ({ ok: true, content: 'Dossier créé.' }));
  const tools = new ToolManager().register(
    defineTool({
      name: 'create_folder',
      description: 'Crée un dossier.',
      risk: 'confirm',
      category: 'files',
      schema: z.object({ name: z.string(), location: z.string().optional() }),
      summarize: ({ name }) => `Créer le dossier « ${name} ».`,
      execute: executed,
    }),
  );
  const audit = new InMemoryAuditLogStore();
  const chat = new ChatSession({
    registry: createDefaultRegistry(),
    tools,
    store,
    auditLog: audit,
    getSettings: () => parseSettings({}),
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => emptyPersonalization() } as never,
    knowledge: { indexConversation: async () => 0 } as never,
  });
  return { chat, executed, audit, store };
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 400; i += 1) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('attente dépassée');
}

describe('ChatSession', () => {
  it('termine le tour même si l’historique ne peut pas être écrit', async () => {
    const events: ChatEvent[] = [];
    const { chat } = session({ save: async () => Promise.reject(new Error('disque plein')) });

    await chat.send(sender(events), { conversationId: null, text: 'Bonjour' });

    expect(events.some((event) => event.type === 'error' && /disque plein/.test(event.message))).toBe(
      true,
    );
    expect(events.at(-1)?.type).toBe('done');
  });

  it('n’exécute rien si l’utilisateur refuse, et le journalise', async () => {
    const events: ChatEvent[] = [];
    const { chat, executed, audit } = session();

    const turn = chat.send(sender(events), {
      conversationId: null,
      text: 'Crée un dossier nommé "Projet"',
    });
    const confirm = await waitFor(() => events.find((event) => event.type === 'confirm'));
    if (confirm.type !== 'confirm') throw new Error('confirmation attendue');
    chat.respondConfirmation(confirm.requestId, false);
    await turn;

    expect(executed).not.toHaveBeenCalled();
    const result = events.find((event) => event.type === 'tool_result');
    expect(result).toMatchObject({ status: 'denied' });
    expect((await audit.list())[0]).toMatchObject({ toolName: 'create_folder', decision: 'refused' });
  });

  it('exécute après accord', async () => {
    const events: ChatEvent[] = [];
    const { chat, executed } = session();

    const turn = chat.send(sender(events), {
      conversationId: null,
      text: 'Crée un dossier nommé "Projet"',
    });
    const confirm = await waitFor(() => events.find((event) => event.type === 'confirm'));
    if (confirm.type !== 'confirm') throw new Error('confirmation attendue');
    chat.respondConfirmation(confirm.requestId, true);
    await turn;

    expect(executed).toHaveBeenCalledTimes(1);
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({ status: 'ok' });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('termine le tour si l’historique est illisible', async () => {
    const events: ChatEvent[] = [];
    const { chat, store } = session();
    store.get = () => Promise.reject(new Error('EPERM'));

    await chat.send(sender(events), { conversationId: 'conv-1', text: 'Bonjour' });

    expect(
      events.some((event) => event.type === 'error' && event.message.includes("n'a pas pu être envoyé")),
    ).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('refuse la confirmation si la fenêtre disparaît', async () => {
    const events: ChatEvent[] = [];
    const { chat, executed } = session();
    let onDestroyed: (() => void) | undefined;
    const web = {
      isDestroyed: () => false,
      send: (_channel: string, event: ChatEvent) => events.push(event),
      once: (_event: string, listener: () => void) => {
        onDestroyed = listener;
      },
      removeListener: () => {
        onDestroyed = undefined;
      },
    };

    const turn = chat.send(web as unknown as Electron.WebContents, {
      conversationId: null,
      text: 'Crée un dossier nommé "Projet"',
    });
    await waitFor(() => events.find((event) => event.type === 'confirm'));
    onDestroyed?.();
    await turn;

    expect(executed).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe('done');
  });
});
