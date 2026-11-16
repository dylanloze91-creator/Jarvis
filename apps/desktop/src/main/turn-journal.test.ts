import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  InMemoryAuditLogStore,
  InMemoryConversationStore,
  ProviderRegistry,
  createDefaultRegistry,
  defineTool,
  emptyPersonalization,
  ollamaDescriptor,
  parseSettings,
  ToolManager,
} from '@jarvis/core';
import type { ChatEvent, SendChatInput } from '../shared/ipc.js';
import { ChatSession } from './session.js';
import { stubLocalLearning } from './test/localLearningStub.js';
import type { TurnLogEntry } from '@jarvis/core';

/**
 * Journal du tour, Jarvis Test seulement. Aucun prompt n'est modifié :
 * les fichiers __golden__ ne sont pas touchés.
 */
const PRECEDENT = process.env.JARVIS_EDITION;

afterAll(() => {
  if (PRECEDENT === undefined) delete process.env.JARVIS_EDITION;
  else process.env.JARVIS_EDITION = PRECEDENT;
});

function sender(events: ChatEvent[]) {
  return {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
}

function fauxOllama(calls: string[]) {
  return new ProviderRegistry().register({ ...ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request: { system?: string }) {
      calls.push(config.model);
      const routeur = (request.system ?? '').includes('chef d');
      const delta = routeur ? (config.model === 'jarvis-trieur' ? 'conversation' : 'conversation') : 'Très bien.';
      yield { type: 'text' as const, delta };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
}

async function tourOrchestre(text: string, orchestra: unknown, place?: SendChatInput['place'], source?: 'voice' | 'text') {
  process.env.JARVIS_EDITION = 'test';
  const calls: string[] = [];
  const settings = parseSettings({ provider: 'ollama', model: 'qwen2.5:3b', orchestra });
  const store = new InMemoryConversationStore();
  const tools = new ToolManager().register(
    defineTool({
      name: 'spotify_play',
      description: 'Lecture. Outil de test.',
      risk: 'safe',
      schema: z.object({}),
      execute: async () => ({ ok: true, content: 'lecture' }),
    }),
  );
  const session = new ChatSession({
    registry: fauxOllama(calls),
    tools,
    store,
    auditLog: new InMemoryAuditLogStore(),
    getSettings: () => settings,
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => emptyPersonalization() } as never,
    knowledge: { indexConversation: async () => 0 } as never,
    localLearning: stubLocalLearning(),
  });
  const events: ChatEvent[] = [];
  await session.send(sender(events), { conversationId: null, text, place, source });
  const saved = (await store.list())[0];
  const conversation = saved ? await store.get(saved.id) : null;
  const reply = events
    .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
    .map((event) => event.text)
    .join('');
  return { conversation, calls, reply, events };
}

function journal(conversation: { turnLog?: TurnLogEntry[] } | null): TurnLogEntry {
  const entry = conversation?.turnLog?.[0];
  if (!entry) throw new Error('journal absent');
  return entry;
}

const ORCHESTRA = {
  enabled: true,
  brain: 'qwen2.5:7b',
  teams: { musique: { model: 'qwen2.5:3b', place: 'processeur' as const } },
};

describe('journal du tour (synthetique-test)', () => {
  it('orchestre, calcul, horloge, express, trieur et chat d’avant', async () => {
    const express = await tourOrchestre('joue du jazz', ORCHESTRA);
    expect(journal(express.conversation)).toMatchObject({
      team: 'musique',
      how: 'express',
      provider: 'ollama',
      model: 'qwen2.5:3b',
      place: 'processeur',
      source: 'texte',
    });
    expect(express.conversation?.routeLog?.[0]).toMatchObject({ team: 'musique', how: 'express' });
    expect(express.reply.length).toBeGreaterThan(0);
    expect(journal(express.conversation).tools.some((tool) => tool.name.startsWith('spotify_'))).toBe(true);

    const calcul = await tourOrchestre('combien font 2 + 2', ORCHESTRA);
    expect(journal(calcul.conversation)).toMatchObject({ team: 'calcul', how: 'calcul', provider: 'aucun', model: null, place: null });
    expect(calcul.calls).toEqual([]);
    expect(calcul.reply).toContain('4');

    const horloge = await tourOrchestre('quelle heure est-il', ORCHESTRA);
    expect(journal(horloge.conversation)).toMatchObject({ team: 'horloge', how: 'horloge', provider: 'aucun', model: null });
    expect(horloge.calls).toEqual([]);
    expect(horloge.reply.toLowerCase()).toContain('il est');

    const cerveau = await tourOrchestre('raconte une histoire de phare', ORCHESTRA);
    expect(journal(cerveau.conversation)).toMatchObject({
      team: 'conversation',
      how: 'cerveau',
      provider: 'ollama',
      model: 'qwen2.5:7b',
      place: 'carte',
    });

    const trieur = await tourOrchestre('raconte une histoire de phare', {
      ...ORCHESTRA,
      router: { model: 'jarvis-trieur', place: 'processeur' as const },
    });
    expect(journal(trieur.conversation)).toMatchObject({ team: 'conversation', how: 'trieur', provider: 'ollama' });

    const store = new InMemoryConversationStore();
    const session = new ChatSession({
      registry: createDefaultRegistry(),
      tools: new ToolManager(),
      store,
      auditLog: new InMemoryAuditLogStore(),
      getSettings: () => parseSettings({}),
      voice: { hasApiKey: () => false } as never,
      personalization: { get: async () => emptyPersonalization() } as never,
      knowledge: { indexConversation: async () => 0 } as never,
      localLearning: stubLocalLearning(),
    });
    await session.send(sender([]), { conversationId: null, text: 'Bonjour' });
    const avant = await store.get((await store.list())[0]!.id);
    expect(journal(avant)).toMatchObject({ team: null, how: null, provider: 'mock', model: 'jarvis-demo', source: 'texte' });
    expect(avant?.routeLog).toBeUndefined();
  });

  it('note un outil, une enceinte et un téléphone', async () => {
    process.env.JARVIS_EDITION = 'test';
    const events: ChatEvent[] = [];
    const store = new InMemoryConversationStore();
    const executed = vi.fn(async () => ({ ok: true, content: 'Dossier créé.' }));
    const session = new ChatSession({
      registry: createDefaultRegistry(),
      tools: new ToolManager().register(
        defineTool({
          name: 'create_folder',
          description: 'Crée un dossier.',
          risk: 'safe',
          schema: z.object({ name: z.string() }),
          execute: executed,
        }),
      ),
      store,
      auditLog: new InMemoryAuditLogStore(),
      getSettings: () => parseSettings({}),
      voice: { hasApiKey: () => false } as never,
      personalization: { get: async () => emptyPersonalization() } as never,
      knowledge: { indexConversation: async () => 0 } as never,
      localLearning: stubLocalLearning(),
    });
    await session.send(sender(events), { conversationId: null, text: 'Crée un dossier nommé Projet' });
    const outil = journal(await store.get((await store.list())[0]!.id));
    expect(outil.tools.some((tool) => tool.name === 'create_folder')).toBe(true);
    expect(executed).toHaveBeenCalled();

    const enceinte = await tourOrchestre('joue du jazz', ORCHESTRA, { kind: 'enceinte', name: 'Salon' }, 'voice');
    expect(journal(enceinte.conversation).source).toBe('enceinte');
    const telephone = await tourOrchestre('joue du jazz', ORCHESTRA, { kind: 'telephone' }, 'text');
    expect(journal(telephone.conversation).source).toBe('telephone');
  });

  it('une réponse fixe du quotidien (notes) est notée sans modèle, jamais avec celui du chat', async () => {
    process.env.JARVIS_EDITION = 'test';
    const store = new InMemoryConversationStore();
    const session = new ChatSession({
      registry: createDefaultRegistry(),
      tools: new ToolManager(),
      store,
      auditLog: new InMemoryAuditLogStore(),
      getSettings: () => parseSettings({ notes: { enabled: true } }),
      voice: { hasApiKey: () => false } as never,
      personalization: { get: async () => emptyPersonalization() } as never,
      knowledge: { indexConversation: async () => 0 } as never,
      localLearning: stubLocalLearning(),
      notes: async () => "C'est noté : acheter du lait.",
    });
    await session.send(sender([]), { conversationId: null, text: 'Note : acheter du lait' });
    const tour = journal(await store.get((await store.list())[0]!.id));
    expect(tour).toMatchObject({ team: null, how: null, provider: 'aucun', model: null });
  });

  it('est absent dans Jarvis Live', async () => {
    process.env.JARVIS_EDITION = 'live';
    // Le fournisseur de démo répond sans réseau.
    const store = new InMemoryConversationStore();
    const session = new ChatSession({
      registry: new ProviderRegistry().register({ ...ollamaDescriptor }, () => ({
        id: 'mock',
        label: 'Démo',
        model: 'jarvis-demo',
        requiresApiKey: false,
        async *streamChat() {
          yield { type: 'text' as const, delta: 'Bonjour.' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
        },
      })),
      tools: new ToolManager(),
      store,
      auditLog: new InMemoryAuditLogStore(),
      getSettings: () => parseSettings({}),
      voice: { hasApiKey: () => false } as never,
      personalization: { get: async () => emptyPersonalization() } as never,
      knowledge: { indexConversation: async () => 0 } as never,
      localLearning: stubLocalLearning(),
    });
    await session.send(sender([]), { conversationId: null, text: 'Bonjour' });
    const saved = await store.get((await store.list())[0]!.id);
    expect(saved?.turnLog).toBeUndefined();
    expect(saved?.routeLog).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain('turnLog');
    expect(saved?.messages.some((message) => message.content === 'Bonjour')).toBe(true);
  });
});
