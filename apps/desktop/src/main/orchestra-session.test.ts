import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * 5.0.60 — chef d'orchestre dans une vraie session de chat : calcul sans modèle, chemin
 * express, choix du cerveau, modèle et outils de l'équipe, repli sur le chat d'avant.
 * Orchestre coupé : `chat-unchanged.test.ts` garde le chat à l'identique.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-orchestra-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.60', isPackaged: false },
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

interface Captured {
  model: string;
  ollama?: unknown;
  system?: string;
  tools: string[];
  lastUser: string;
}

const ORCHESTRA = {
  enabled: true,
  brain: 'qwen2.5:7b',
  teams: {
    musique: { model: 'qwen2.5:3b', place: 'processeur' as const },
    code: { model: 'qwen2.5-coder:7b', place: 'processeur' as const },
  },
};

function settingsWith(orchestra: unknown) {
  return core.parseSettings({ provider: 'ollama', model: 'qwen2.5:3b', orchestra });
}

async function turn(text: string, brainReply: string, orchestra: unknown = ORCHESTRA) {
  const settings = settingsWith(orchestra);
  const getSettings = () => settings;
  const requests: Captured[] = [];
  const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request) {
      requests.push({
        model: config.model,
        ollama: config.ollama,
        system: request.system,
        tools: (request.tools ?? []).map((tool) => tool.name),
        lastUser: request.messages.at(-1)?.content ?? '',
      });
      const router = (request.system ?? '').includes('chef d’orchestre');
      yield { type: 'text' as const, delta: router ? brainReply : 'Très bien.' };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
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
  });
  await session.send(sender, { conversationId: null, text });
  const route = events.find((event) => event.type === 'route');
  const reply = events
    .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
    .map((event) => event.text)
    .join('');
  return { requests, events, route, reply };
}

describe('chef d’orchestre dans le chat (5.0.60)', () => {
  it('calcul : résultat exact, aucun modèle appelé', async () => {
    const { requests, route, reply } = await turn('Combien font 12 fois 37 ?', 'pc');
    expect(requests).toHaveLength(0);
    expect(route).toMatchObject({ type: 'route', team: 'calcul', how: 'calcul', model: 'sans modèle' });
    expect(reply).toBe('12 × 37 = 444.');
  });

  it('heure : lue sur l’horloge du PC, aucun modèle appelé', async () => {
    const { requests, route, reply } = await turn('Quelle heure est-il ?', 'pc');
    expect(requests).toHaveLength(0);
    expect(route).toMatchObject({ team: 'horloge', how: 'express', model: 'sans modèle' });
    expect(reply).toMatch(/^Il est \d\d h \d\d\.$/);
  });

  it('express : Spotify part sans demander au cerveau', async () => {
    const { requests, route } = await turn('Mets Daft Punk sur Spotify', 'pc');
    expect(route).toMatchObject({ team: 'musique', how: 'express', model: 'qwen2.5:3b' });
    expect(requests.some((request) => request.model === 'qwen2.5:7b')).toBe(false);
  });

  it('cerveau → équipe PC : le 7B choisit, puis répond avec les seuls outils du PC et une consigne courte', async () => {
    const { requests, route, reply } = await turn('Ouvre le Bloc-notes', 'pc');
    expect(requests).toHaveLength(2);
    const [brain, team] = requests;
    expect(brain).toMatchObject({ model: 'qwen2.5:7b', tools: [], ollama: { keepAlive: '30m', recoverToolCalls: true } });
    expect(brain!.lastUser).toContain('Demande : Ouvre le Bloc-notes');
    expect(route).toMatchObject({ team: 'pc', how: 'cerveau', model: 'qwen2.5:7b', label: 'PC et applications' });
    expect(team!.model).toBe('qwen2.5:7b');
    expect(team!.tools).toContain('open_application');
    expect(team!.tools.every((name) => core.teamHasTool('pc', name))).toBe(true);
    expect(team!.tools).not.toContain('web_search');
    expect(team!.system).toContain(core.ORCHESTRA_BASE_PROMPT);
    expect(team!.system).toContain('ÉQUIPE PC ET APPLICATIONS');
    expect(team!.system).not.toContain('web_research avec 2 à 4 requêtes');
    expect(reply).toBe('Très bien.');
  });

  it('cerveau → équipe code : modèle de code sur le processeur, sans outil', async () => {
    const { requests, route } = await turn('Écris une fonction qui inverse une chaîne', 'code');
    expect(route).toMatchObject({ team: 'code', model: 'qwen2.5-coder:7b' });
    const team = requests[1]!;
    expect(team).toMatchObject({ model: 'qwen2.5-coder:7b', tools: [], ollama: { numGpu: 0, keepAlive: '10m' } });
  });

  it('réponse illisible du cerveau : le chat d’avant (modèle, catalogue et prompt habituels)', async () => {
    const { requests, route } = await turn('Ouvre le Bloc-notes', 'banane');
    expect(route).toBeUndefined();
    const normal = requests[1]!;
    expect(normal.model).toBe('qwen2.5:3b');
    expect(normal.system).toContain('pas un assistant uniquement musical');
    expect(normal.tools).toContain('web_search');
    expect(normal.tools).toContain('open_application');
  });

  it('orchestre coupé : aucune pastille, aucun appel au cerveau', async () => {
    const { requests, route } = await turn('Combien font 12 fois 37 ?', 'pc', { ...ORCHESTRA, enabled: false });
    expect(route).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.model).toBe('qwen2.5:3b');
  });
});
