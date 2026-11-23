import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * 23 novembre 2026, dans une vraie session de chat :
 * - une demande de note « … ma liste » ne part jamais à un modèle (aucune équipe du chef
 *   d'orchestre n'a la liste) ;
 * - un modèle qui dit « Bien noté » sans qu'aucun outil n'ait rien écrit est corrigé ;
 * - « mets de la musique (sur …) » reprend Spotify sans modèle.
 * Phrases écrites pour ces essais.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-notes-musique-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.1.0-test.2', isPackaged: false },
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
  teams: { musique: { model: 'qwen2.5:3b', place: 'processeur' as const } },
};

interface Options {
  orchestra?: unknown;
  notes?: boolean;
  brainReply?: string;
  teamReply?: string;
}

async function turn(text: string, options: Options = {}) {
  const settings = core.parseSettings({
    provider: 'ollama',
    model: 'qwen2.5:3b',
    ...(options.orchestra === null ? {} : { orchestra: options.orchestra ?? ORCHESTRA }),
    ...(options.notes === undefined ? {} : { notes: { enabled: options.notes } }),
  });
  const getSettings = () => settings;
  let modelCalls = 0;
  const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request) {
      modelCalls += 1;
      const router = (request.system ?? '').includes('chef d’orchestre');
      yield { type: 'text' as const, delta: router ? (options.brainReply ?? 'conversation') : (options.teamReply ?? 'Très bien.') };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
  const events: ChatEvent[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
  const added: string[] = [];
  const store = new core.InMemoryConversationStore();
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
    store,
    auditLog: new core.InMemoryAuditLogStore(),
    getSettings,
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => core.emptyPersonalization() } as never,
    knowledge: { indexConversation: async () => 0 } as never,
    localLearning: { recordTurn: async () => undefined } as never,
    // Même chemin que le processus principal : la règle, puis le carnet de notes (ici en mémoire).
    notes: async ({ text: phrase }) => {
      const intent = core.noteIntent(phrase);
      if (intent?.kind !== 'add') return null;
      added.push(intent.body);
      return `C'est noté : ${intent.body}.`;
    },
  });
  await session.send(sender, { conversationId: null, text });
  const reply = events
    .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
    .map((event) => event.text)
    .join('');
  const started = events.find((event) => event.type === 'started');
  const saved = started && 'conversationId' in started ? await store.get(started.conversationId) : null;
  const tools = events
    .filter((event): event is Extract<ChatEvent, { type: 'tool_start' }> => event.type === 'tool_start')
    .map((event) => event.toolName);
  return { reply, modelCalls, added, saved, tools, route: events.find((event) => event.type === 'route') };
}

describe('notes « … ma liste » dans la session', () => {
  it('liste activée : la note est prise sans modèle', async () => {
    const result = await turn('Inscris dans ma liste de racheter des piles', { notes: true });
    expect(result.modelCalls).toBe(0);
    expect(result.added).toEqual(['racheter des piles']);
    expect(result.reply).toBe("C'est noté : racheter des piles.");
  });

  it('liste coupée, chef d’orchestre actif : rien n’est noté, et c’est dit, sans modèle', async () => {
    const result = await turn('Mets des ampoules sur ma liste', { notes: false, brainReply: 'pc', teamReply: 'Bien noté !' });
    expect(result.modelCalls).toBe(0);
    expect(result.reply).toBe(core.NOTES_OFF_REPLY);
  });

  it('liste coupée, sans chef d’orchestre : pas d’outil des notes, même réponse sans modèle', async () => {
    const result = await turn('Ajoute appeler le garage à ma liste', { orchestra: null, teamReply: 'Bien noté !' });
    expect(result.modelCalls).toBe(0);
    expect(result.reply).toBe(core.NOTES_OFF_REPLY);
  });

  it('contenu illisible : Jarvis le dit, sans modèle', async () => {
    const result = await turn('Ajoute à ma liste', { notes: true, teamReply: 'Bien noté !' });
    expect(result.modelCalls).toBe(0);
    expect(result.reply).toBe(core.NOTE_UNCLEAR_REPLY);
  });
});

describe('« Bien noté » sans outil', () => {
  it('la réponse est corrigée, à l’écran et dans l’historique', async () => {
    const result = await turn('Garde en tête mon idée de cadeau pour samedi', {
      brainReply: 'conversation',
      teamReply: 'Bien noté, je m’en souviendrai.',
    });
    expect(result.modelCalls).toBe(2);
    expect(result.reply).toContain(core.NOTE_CLAIM_CORRECTION);
    const last = result.saved?.messages.filter((message) => message.role === 'assistant').at(-1);
    expect(last?.content).toContain(core.NOTE_CLAIM_CORRECTION);
  });

  it('une réponse qui ne prétend rien n’est pas touchée', async () => {
    const result = await turn('Raconte-moi une blague courte', { brainReply: 'conversation', teamReply: 'Très bien.' });
    expect(result.reply).toBe('Très bien.');
  });
});

describe('« mets de la musique » dans la session', () => {
  it.each(['Lance un peu de musique', 'Mets de la musique sur mon PC', 'Joue de la musique sur l’enceinte stp'])(
    '« %s » : équipe Musique en express, spotify_resume sans modèle',
    async (phrase) => {
      const result = await turn(phrase, { teamReply: 'Je lance la musique !' });
      expect(result.route && 'team' in result.route ? result.route.team : null).toBe('musique');
      expect(result.tools[0]).toBe('spotify_resume');
      expect(result.modelCalls).toBe(0);
    },
  );
});
