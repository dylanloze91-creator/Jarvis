import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';
import { ChatMissionHub } from './chatMission/hub.js';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-chat-mission-direct-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.68', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { createToolManager } = await import('./tools/index.js');
const { ChatSession } = await import('./session.js');
const { SpotifyBridge } = await import('./media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('./siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('./personalization.js');
const { KnowledgeStore } = await import('./knowledge.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

const ORCHESTRA = {
  enabled: true,
  brain: 'qwen2.5:7b',
  teams: {
    code: { model: 'qwen2.5-coder:7b', place: 'processeur' as const },
  },
};

function sessionWithHub(
  hub: ChatMissionHub,
  streamChat: NonNullable<Parameters<typeof core.ProviderRegistry.prototype.register>[1]> extends (
    config: infer C,
  ) => infer R
    ? (config: C) => R
    : never,
) {
  const settings = core.parseSettings({
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
    orchestra: ORCHESTRA,
    developer: {
      enabled: true,
      repoPath: 'C:\\dev\\Jarvis',
      chatMissions: true,
      codeModel: 'qwen2.5-coder:7b',
    },
  });
  const getSettings = () => settings;
  const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, streamChat);
  const events: ChatEvent[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
  const session = new ChatSession({
    registry,
    tools: createToolManager({
      getSettings,
      searchRegistry: core.createDefaultSearchRegistry(),
      marketDataRegistry: core.createDefaultMarketDataRegistry(),
      spotify: new SpotifyBridge(getSettings),
      siteBlock: new SiteBlockBridge(getSettings),
      personalization: new PersonalizationStore(),
      knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
    }),
    store: new core.InMemoryConversationStore(),
    auditLog: new core.InMemoryAuditLogStore(),
    getSettings,
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => core.emptyPersonalization() } as never,
    knowledge: { indexConversation: async () => 0 } as never,
    localLearning: { recordTurn: async () => undefined } as never,
    getChatMissionHub: () => hub,
  });
  return { session, sender, events, getSettings };
}

describe('missions directes depuis la discussion (5.0.69)', () => {
  it('demande claire → carte sans appel au modèle Code', async () => {
    const settings = core.parseSettings({
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      orchestra: ORCHESTRA,
      developer: {
        enabled: true,
        repoPath: 'C:\\dev\\Jarvis',
        chatMissions: true,
        codeModel: 'qwen2.5-coder:7b',
      },
    });
    const getSettings = () => settings;
    const hub = new ChatMissionHub({ getSettings, developer: () => null });
    let codeCalls = 0;
    const { session, sender, events } = sessionWithHub(hub, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request) {
        const router = (request.system ?? '').includes('chef d’orchestre');
        if (router) {
          yield { type: 'text' as const, delta: 'code' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
          return;
        }
        codeCalls += 1;
        throw new Error('Le modèle Code ne devrait pas être appelé');
      },
    }));
    const phrase =
      'Jarvis, écris-moi un script Python pour lancer mes impressions 3D depuis Mainsail';
    await session.send(sender, { conversationId: null, text: phrase });
    expect(codeCalls).toBe(0);
    const route = events.find((event) => event.type === 'route');
    expect(route?.how).toBe('mission-directe');
    const proposal = events.find((event) => event.type === 'mission_proposal');
    expect(proposal?.message.chatMission?.kind).toBe('proposal');
    const data =
      proposal?.message.chatMission?.kind === 'proposal' ? proposal.message.chatMission.data : undefined;
    expect(data?.objectif).toContain('impressions 3D');
    expect(data?.objectif.toLowerCase()).not.toContain('jarvis');
    expect(data?.languageNotice).toContain('Python');
    expect(data?.launchObjectif).toContain('JavaScript / Node');
  });

  it('mission en cours → pas de carte', async () => {
    const getSettings = () =>
      core.parseSettings({
        provider: 'ollama',
        model: 'qwen2.5-coder:7b',
        orchestra: ORCHESTRA,
        developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', chatMissions: true, codeModel: 'x' },
      });
    const hub = new ChatMissionHub({
      getSettings,
      developer: () =>
        ({
          state: () => ({
            mission: { status: 'running' },
          }),
        }) as never,
    });
    const { session, sender, events } = sessionWithHub(hub, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request) {
        if ((request.system ?? '').includes('chef d’orchestre')) {
          yield { type: 'text' as const, delta: 'code' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
          return;
        }
        throw new Error('modèle code interdit');
      },
    }));
    await session.send(sender, {
      conversationId: null,
      text: 'Crée-moi un script pour sauvegarder mes fichiers',
    });
    expect(events.some((event) => event.type === 'mission_proposal')).toBe(false);
    const done = events.find((event) => event.type === 'done');
    expect(done?.messages.some((message) => message.content.includes('déjà en cours'))).toBe(true);
  });

  it('réglage coupé → chemin modèle (phrase floue)', async () => {
    const settings = core.parseSettings({
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      orchestra: ORCHESTRA,
      developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', chatMissions: false, codeModel: 'x' },
    });
    const getSettings = () => settings;
    const hub = new ChatMissionHub({ getSettings, developer: () => null });
    let codeCalls = 0;
    const { session, sender, events } = sessionWithHub(hub, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request) {
        if ((request.system ?? '').includes('chef d’orchestre')) {
          yield { type: 'text' as const, delta: 'code' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
          return;
        }
        codeCalls += 1;
        yield { type: 'text' as const, delta: 'Réponse normale.' };
        yield { type: 'done' as const, finishReason: 'stop' as const };
      },
    }));
    await session.send(sender, {
      conversationId: null,
      text: 'Crée-moi un script pour archiver mes photos',
    });
    expect(codeCalls).toBe(1);
    expect(events.some((event) => event.type === 'mission_proposal')).toBe(false);
  });

  it('modèle qui écrit la mission sans outil → carte depuis la demande', async () => {
    const getSettings = () =>
      core.parseSettings({
        provider: 'ollama',
        model: 'qwen2.5-coder:7b',
        orchestra: ORCHESTRA,
        developer: {
          enabled: true,
          repoPath: 'C:\\dev\\Jarvis',
          chatMissions: true,
          codeModel: 'qwen2.5-coder:7b',
        },
      });
    const hub = new ChatMissionHub({ getSettings, developer: () => null });
    const fuzzy =
      'Peut-être un utilitaire demain pour trier mes fichiers csv sur le bureau';
    const { session, sender, events } = sessionWithHub(hub, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request) {
        if ((request.system ?? '').includes('chef d’orchestre')) {
          yield { type: 'text' as const, delta: 'code' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
          return;
        }
        yield {
          type: 'text' as const,
          delta:
            'Objectif : SSH vers le serveur\nProjet : nouveau\nType : Nouveau-projet\nEst-ce que cela te convient ?',
        };
        yield { type: 'done' as const, finishReason: 'stop' as const };
      },
    }));
    await session.send(sender, { conversationId: null, text: fuzzy });
    const proposal = events.find((event) => event.type === 'mission_proposal');
    const fallback =
      proposal?.message.chatMission?.kind === 'proposal' ? proposal.message.chatMission.data : undefined;
    expect(fallback?.objectifReprise).toBe(true);
    expect(fallback?.objectif).toContain('fichiers csv');
  });

  it('arrêt pendant le tour → aucune carte (chemin direct)', async () => {
    const getSettings = () =>
      core.parseSettings({
        provider: 'ollama',
        model: 'qwen2.5-coder:7b',
        orchestra: ORCHESTRA,
        developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', chatMissions: true, codeModel: 'x' },
      });
    const hub = new ChatMissionHub({ getSettings, developer: () => null });
    const { session, events } = sessionWithHub(hub, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request) {
        if ((request.system ?? '').includes('chef d’orchestre')) {
          yield { type: 'text' as const, delta: 'code' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
          return;
        }
        throw new Error('modèle code interdit');
      },
    }));
    // L'utilisateur clique « Arrêter » pendant que la phrase d'introduction s'affiche.
    const stoppingSender = {
      isDestroyed: () => false,
      send: (_channel: string, event: ChatEvent) => {
        events.push(event);
        if (event.type === 'delta') session.cancel();
      },
    } as unknown as Electron.WebContents;
    await session.send(stoppingSender, {
      conversationId: null,
      text: 'Crée-moi un script pour sauvegarder mes fichiers',
    });
    expect(events.some((event) => event.type === 'route' && event.how === 'mission-directe')).toBe(true);
    expect(events.some((event) => event.type === 'mission_proposal')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });

  it('arrêt pendant le tour → aucune carte (filet « mission écrite en texte »)', async () => {
    const getSettings = () =>
      core.parseSettings({
        provider: 'ollama',
        model: 'qwen2.5-coder:7b',
        orchestra: ORCHESTRA,
        developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', chatMissions: true, codeModel: 'x' },
      });
    const hub = new ChatMissionHub({ getSettings, developer: () => null });
    let cancel: () => void = () => undefined;
    const { session, sender, events } = sessionWithHub(hub, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request) {
        if ((request.system ?? '').includes('chef d’orchestre')) {
          yield { type: 'text' as const, delta: 'code' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
          return;
        }
        yield {
          type: 'text' as const,
          delta: 'Objectif : trier des fichiers\nProjet : nouveau\nType : Nouveau-projet\nEst-ce que cela te convient ?',
        };
        cancel();
        yield { type: 'done' as const, finishReason: 'stop' as const };
      },
    }));
    cancel = () => session.cancel();
    await session.send(sender, {
      conversationId: null,
      text: 'Peut-être un utilitaire demain pour trier mes fichiers csv sur le bureau',
    });
    expect(events.some((event) => event.type === 'mission_proposal')).toBe(false);
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });
});
