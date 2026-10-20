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
import { stubLocalLearning } from './test/localLearningStub.js';

function sender(events: ChatEvent[]) {
  return {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
}

function session(options: { save?: () => Promise<void>; knowledge?: Record<string, unknown> } = {}) {
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
    knowledge: { indexConversation: async () => 0, ...options.knowledge } as never,
    localLearning: stubLocalLearning(),
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

  it('un tour remplacé par le suivant ne renvoie pas « done »', async () => {
    const events: ChatEvent[] = [];
    const { chat } = session();
    const first = chat.send(sender(events), {
      conversationId: null,
      text: 'Crée un dossier nommé "Projet"',
    });
    await waitFor(() => events.find((event) => event.type === 'confirm'));
    const second = chat.send(sender(events), { conversationId: null, text: 'Bonjour' });
    await Promise.all([first, second]);
    const started = events.flatMap((event) => (event.type === 'started' ? [event.message.content] : []));
    expect(started).toEqual(['Crée un dossier nommé "Projet"', 'Bonjour']);
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
  });

  it('range une correction et ignore une consigne ponctuelle', async () => {
    const events: ChatEvent[] = [];
    const applyLearning = vi.fn(async (_record: { type?: string; status?: string; origin?: string }) => []);
    const relevantLearning = vi.fn(async () => [
      {
        id: 'corr',
        type: 'correction',
        content: 'Non, le respawn est la touche R',
        origin: 'user',
        createdAt: 1,
        lastCheckedAt: 1,
        confidence: 0.9,
        confidenceReason: 'explicite',
        status: 'validated',
        sources: [],
        links: [],
      },
    ]);
    const seen: string[] = [];
    const { chat } = session({ knowledge: { applyLearning, relevantLearning } });
    const registry = (chat as unknown as { deps: { registry: { createOrFallback: (config: never) => { provider: { streamChat: (request: { system?: string }) => AsyncIterable<unknown> }; fellBack: boolean } } } }).deps.registry;
    const original = registry.createOrFallback.bind(registry);
    registry.createOrFallback = ((config: never) => {
      const created = original(config);
      const provider = created.provider;
      const streamChat = provider.streamChat.bind(provider);
      provider.streamChat = (request: { system?: string }) => {
        if (request.system) seen.push(request.system);
        return streamChat(request);
      };
      return created;
    }) as typeof registry.createOrFallback;

    await chat.send(sender(events), { conversationId: null, text: 'juste cette fois, réponds court' });
    expect(applyLearning).not.toHaveBeenCalled();

    await chat.send(sender(events), { conversationId: null, text: 'Non, le respawn est la touche R' });
    expect(applyLearning).toHaveBeenCalledTimes(1);
    expect(applyLearning).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'correction', status: 'validated', origin: 'user' }),
    );
    expect(seen.some((prompt) => prompt.includes('touche R') && prompt.includes('Applique-les'))).toBe(
      true,
    );
    expect(seen.some((prompt) => prompt.includes('N’exécute aucune commande'))).toBe(true);
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
