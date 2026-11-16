import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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

const spieFetch = vi.fn(async (input: URL | string) => {
  const url = String(input);
  if (url.includes('/v1/finance/search')) {
    return new Response(
      JSON.stringify({
        quotes: [
          {
            symbol: 'SPIE.PA',
            shortname: 'SPIE',
            longname: 'SPIE SA',
            quoteType: 'EQUITY',
            exchange: 'PAR',
            exchDisp: 'Paris',
          },
        ],
      }),
      { status: 200 },
    );
  }
  if (url.includes('/v8/finance/chart/')) {
    return new Response(
      JSON.stringify({
        chart: {
          result: [
            {
              meta: {
                symbol: 'SPIE.PA',
                currency: 'EUR',
                fullExchangeName: 'Euronext Paris',
                regularMarketPrice: 34.12,
                regularMarketChangePercent: 1.2,
                chartPreviousClose: 33.71,
                regularMarketTime: Date.parse('2026-11-11T16:35:00.000Z') / 1000,
              },
            },
          ],
        },
      }),
      { status: 200 },
    );
  }
  throw new Error(`URL inattendue : ${url}`);
});

async function turn(
  text: string,
  brainReply: string,
  orchestra: unknown = ORCHESTRA,
  routerReply?: string,
  withGoogle = false,
) {
  const trieurReply = routerReply ?? brainReply;
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
      const delta = router
        ? config.model === 'jarvis-trieur'
          ? trieurReply
          : brainReply
        : 'Très bien.';
      yield { type: 'text' as const, delta };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
  const events: ChatEvent[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
  const tools = createToolManager({
    getSettings,
    searchRegistry: core.createDefaultSearchRegistry(),
    marketDataRegistry: core.createDefaultMarketDataRegistry(),
    spotify: new SpotifyBridge(getSettings),
    siteBlock: new SiteBlockBridge(getSettings),
    personalization: new PersonalizationStore(),
    knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
  });
  if (withGoogle) {
    tools.register(
      core.defineTool({
        name: 'google_gmail_search',
        description: 'Lire les mails. Outil de test.',
        risk: 'safe',
        schema: z.object({}),
        execute: async () => ({ ok: true, content: 'aucun mail' }),
      }),
    );
  }
  const session = new ChatSession({
    registry,
    tools,
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

async function stockTurn(text: string) {
  let modelCalls = 0;
  const settings = settingsWith(ORCHESTRA);
  const getSettings = () => settings;
  const audit = new core.InMemoryAuditLogStore();
  const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, () => ({
    id: 'ollama',
    label: 'Ollama',
    model: 'interdit',
    requiresApiKey: false,
    async *streamChat() {
      modelCalls += 1;
      throw new Error('le modèle ne doit pas être appelé');
      yield { type: 'text' as const, delta: '' };
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
    auditLog: audit,
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
  return { modelCalls, route, reply, audit };
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

  it('trieur choisi : le triage part vers ce modèle avec keep_alive 30 min', async () => {
    const orchestra = {
      ...ORCHESTRA,
      router: { model: 'jarvis-trieur', place: 'carte' as const },
    };
    const ok = await turn('Ouvre le Bloc-notes', 'pc', orchestra);
    expect(ok.route).toMatchObject({ how: 'trieur', team: 'pc' });
    expect(ok.requests[0]).toMatchObject({
      model: 'jarvis-trieur',
      ollama: { keepAlive: '30m', recoverToolCalls: true },
    });
    expect(ok.requests[0]?.system).toContain('chef d’orchestre');
  });

  it('trieur illisible : le cerveau choisit l’équipe (pas le chat d’avant)', async () => {
    const orchestra = {
      ...ORCHESTRA,
      router: { model: 'jarvis-trieur', place: 'carte' as const },
    };
    const bad = await turn('Salut', 'pc', orchestra, '***');
    expect(bad.route).toMatchObject({ how: 'cerveau', team: 'pc' });
    expect(bad.requests[0]?.model).toBe('jarvis-trieur');
    expect(bad.requests[1]).toMatchObject({ model: 'qwen2.5:7b', ollama: { keepAlive: '30m', recoverToolCalls: true } });
    expect(bad.requests[2]?.model).toBe('qwen2.5:7b');
    expect(bad.requests.some((r) => r.model === 'qwen2.5:3b')).toBe(false);
  });

  it('validation en direct : métadonnées sous la pastille express si dossier configuré', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-valide-route-'));
    const orchestra = {
      ...ORCHESTRA,
      trieurDataDir: dir,
      teamValidation: true,
    };
    const { route } = await turn('Mets Daft Punk sur Spotify', 'pc', orchestra);
    expect(route?.validation).toMatchObject({
      proposedTeam: 'musique',
      path: 'express',
      phrase: 'Mets Daft Punk sur Spotify',
    });
    expect(route?.validation?.teams.some((team) => team.id === 'musique')).toBe(true);
  });

  it('passe par Yahoo Finance → équipe web, sans demander au cerveau', async () => {
    const { requests, route } = await turn('passe par Yahoo Finance', 'google');
    expect(route).toMatchObject({ team: 'web', how: 'express' });
    expect(requests.some((request) => (request.system ?? '').includes('chef d’orchestre'))).toBe(false);
    expect(requests[0]?.system).toContain('ÉQUIPE INTERNET');
  });

  it('lis mes mails → équipe Google, sans demander au cerveau', async () => {
    const { requests, route } = await turn('lis mes mails', 'web', ORCHESTRA, undefined, true);
    expect(route).toMatchObject({ team: 'google', how: 'express', label: 'Google' });
    expect(requests.some((request) => (request.system ?? '').includes('chef d’orchestre'))).toBe(false);
    expect(requests[0]?.system).toContain('ÉQUIPE GOOGLE');
  });

  it('le cours de SPIE appelle l’outil, le faux modèle échoue s’il est appelé', async () => {
    vi.stubGlobal('fetch', spieFetch);
    try {
      const { modelCalls, route, reply, audit } = await stockTurn('le cours de SPIE');
      expect(modelCalls).toBe(0);
      expect(route).toMatchObject({ type: 'route', team: 'bourse', label: 'Bourse', model: 'express', how: 'express' });
      expect(reply).toBe("SPIE, Euronext Paris : 34,12 €, en hausse de 1,2 % aujourd'hui (17 h 35).");
      const entries = await audit.list();
      expect(entries.some((entry) => entry.toolName === 'get_stock_quote' && entry.status === 'ok')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cherche sur Google le cours de SPIE → bourse express, pas l’équipe Google', async () => {
    vi.stubGlobal('fetch', spieFetch);
    try {
      const { modelCalls, route, reply } = await stockTurn('cherche sur Google le cours de SPIE');
      expect(modelCalls).toBe(0);
      expect(route).toMatchObject({ team: 'bourse', how: 'express', label: 'Bourse', model: 'express' });
      expect(reply).toContain('SPIE, Euronext Paris');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cours introuvable : aucune invention', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ quotes: [] }), { status: 200 })),
    );
    try {
      const { modelCalls, reply } = await stockTurn('le cours de SPIE');
      expect(modelCalls).toBe(0);
      expect(reply).toBe("Je n'ai pas trouvé SPIE à la bourse. Tu peux me donner son symbole ?");
      expect(reply).not.toMatch(/\d/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('correction « non » : le cerveau apprend que l’équipe précédente n’a pas su', async () => {
    const settings = settingsWith(ORCHESTRA);
    const getSettings = () => settings;
    const requests: Captured[] = [];
    const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request: { system?: string; messages: { content: string }[] }) {
        requests.push({
          model: config.model,
          system: request.system,
          tools: [],
          lastUser: request.messages.at(-1)?.content ?? '',
        });
        const router = (request.system ?? '').includes('chef d’orchestre');
        const user = request.messages.at(-1)?.content ?? '';
        const delta = router ? (user.includes("n'a pas su") ? 'pc' : 'web') : 'Très bien.';
        yield { type: 'text' as const, delta };
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
    await session.send(sender, { conversationId: null, text: 'Ouvre le Bloc-notes' });
    const done = events.find((event) => event.type === 'done');
    expect(events.find((event) => event.type === 'route')).toMatchObject({ team: 'web', how: 'cerveau' });
    const conversationId = done && done.type === 'done' ? done.conversationId : '';
    requests.length = 0;
    events.length = 0;
    await session.send(sender, { conversationId, text: 'non' });
    expect(requests[0]?.lastUser).toContain("l'équipe web n'a pas su répondre au tour précédent");
    expect(events.find((event) => event.type === 'route')).toMatchObject({ team: 'pc', how: 'cerveau' });
  });

  it('validation en direct : absente sur calcul exact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-valide-calc-'));
    const orchestra = {
      ...ORCHESTRA,
      trieurDataDir: dir,
      teamValidation: true,
    };
    const { route } = await turn('Combien font 12 fois 37 ?', 'pc', orchestra);
    expect(route?.validation).toBeUndefined();
  });
});
