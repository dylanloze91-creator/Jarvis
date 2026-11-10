import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Mode direct de Jarvis Imager dans une vraie session de chat : `/image …` et une demande repérée
 * par règles partent à Imager sans qu'aucun modèle de langage ne soit appelé ; le tour est marqué
 * `direct` et n'est jamais renvoyé au modèle ensuite ; quand le modèle répond sans Imager à ce qui
 * ressemblait à une image, la discussion reçoit le bouton « Envoyer à Imager ».
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-direct-image-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.73', isPackaged: false },
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

interface FakeImages {
  enabled: boolean;
  generated: { prompt: string; project: string; improve?: boolean }[];
  fail?: string;
}

/** Faux service d'images : enregistre les demandes directes, ne lance rien. */
function fakeImages(state: FakeImages) {
  return {
    isEnabled: () => state.enabled,
    settings: () => ({ openAfterGeneration: false }),
    loadRules: async () => ({ rules: core.DEFAULT_IMAGER_RULES, warnings: [] }),
    generateDirect: async (request: { prompt: string; project: string; improve?: boolean }, context: { onProgress?: (m: string) => void }) => {
      state.generated.push(request);
      context.onProgress?.('Forge est prêt, je fabrique l’image…');
      if (state.fail) throw new Error(state.fail);
      return {
        project: request.project,
        folder: 'C:\\dev\\Jarvis_images\\perso\\2026-11-10',
        files: [{ png: 'C:\\dev\\Jarvis_images\\perso\\2026-11-10\\x-1.png', seed: 7, preview: 'data:image/png;base64,AA==' }],
        width: 1024,
        height: 1024,
        durationMs: 1500,
        warnings: [],
        finalPrompt: `${request.prompt}, highly detailed`,
        finalNegative: 'blurry',
        improved: request.improve !== false,
        checkpoint: { id: 'realvisxl', label: 'RealVisXL V5.0' },
        subjectType: 'autre',
        adetailer: false,
        forgeHeld: false,
        brainReloaded: 'qwen2.5:7b',
      };
    },
  };
}

interface Captured {
  model: string;
  lastUser: string;
  userMessages: string[];
}

function harness(state: FakeImages, options: { orchestra?: boolean; imagesTool?: boolean } = {}) {
  const settings = core.parseSettings({
    provider: 'ollama',
    model: 'qwen2.5:3b',
    ...(options.orchestra ? { orchestra: { enabled: true, brain: 'qwen2.5:7b' } } : {}),
    images: { enabled: state.enabled },
  });
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
        lastUser: request.messages.at(-1)?.content ?? '',
        userMessages: request.messages.filter((message) => message.role === 'user').map((message) => message.content),
      });
      const router = (request.system ?? '').includes('chef d’orchestre');
      yield { type: 'text' as const, delta: router ? 'conversation' : 'Je ne peux pas faire ça moi-même.' };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
  const events: ChatEvent[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
  const store = new core.InMemoryConversationStore();
  const indexed: string[] = [];
  const learned: string[][] = [];
  const images = fakeImages(state);
  const noted: string[] = [];
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
      ...(options.imagesTool ? { images: images as never } : {}),
    }),
    store,
    auditLog: new core.InMemoryAuditLogStore(),
    getSettings,
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => core.emptyPersonalization() } as never,
    knowledge: { indexConversation: async (_id: string, text: string) => (indexed.push(text), 0) } as never,
    localLearning: { recordTurn: async (_id: string, messages: { content: string }[]) => (learned.push(messages.map((m) => m.content)), undefined) } as never,
    images: images as never,
    noteUserTurn: (turn) => noted.push(turn.text),
  });
  const turn = async (text: string, conversationId: string | null = null) => {
    events.length = 0;
    await session.send(sender, { conversationId, text });
    const done = events.find((event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done');
    return { events: [...events], done, conversationId: done?.conversationId ?? null };
  };
  return { turn, requests, store, indexed, learned, noted };
}

describe('mode direct de Jarvis Imager dans la session', () => {
  it('/image : aucun modèle appelé, Imager reçoit la consigne, le tour est marqué direct et exclu de la mémoire', async () => {
    const state: FakeImages = { enabled: true, generated: [] };
    const h = harness(state);
    const { events, done } = await h.turn('/image un renard roux dans la neige');
    expect(h.requests).toHaveLength(0);
    expect(state.generated).toEqual([{ prompt: 'un renard roux dans la neige', negative: '', project: 'perso' }]);
    expect(events.find((event) => event.type === 'route')).toMatchObject({ team: 'images', label: 'Jarvis Imager', how: 'direct' });
    expect(events.find((event) => event.type === 'tool_start')).toMatchObject({ toolName: 'generer_image' });
    expect(events.find((event) => event.type === 'tool_progress')).toMatchObject({ message: 'Forge est prêt, je fabrique l’image…' });
    const result = events.find((event): event is Extract<ChatEvent, { type: 'tool_result' }> => event.type === 'tool_result');
    expect(result?.status).toBe('ok');
    expect(result?.content).toContain('x-1.png');
    expect(result?.content).toContain('Consigne envoyée à Stable Diffusion : un renard roux dans la neige, highly detailed');
    expect(done?.messages.map((message) => [message.role, message.direct])).toEqual([
      ['user', 'image'],
      ['assistant', 'image'],
    ]);
    expect(h.noted).toEqual(['/image un renard roux dans la neige']);
    // Ni mémoire, ni apprentissage pour un tour direct.
    expect(h.indexed).toEqual([]);
    expect(h.learned).toEqual([]);
  });

  it('le tour direct n’est jamais renvoyé au modèle dans la suite de la conversation', async () => {
    const state: FakeImages = { enabled: true, generated: [] };
    const h = harness(state);
    const first = await h.turn('/image a cat');
    const second = await h.turn('Quel temps fait-il dans ma tête ?', first.conversationId);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.userMessages).toEqual(['Quel temps fait-il dans ma tête ?']);
    expect(second.done?.messages).toHaveLength(4);
    // L'apprentissage local ne reçoit pas non plus le tour direct.
    expect(h.learned.at(-1)).toEqual(['Quel temps fait-il dans ma tête ?', 'Je ne peux pas faire ça moi-même.']);
  });

  it('une demande repérée par règles (« Imager, … », « génère une image de … ») part à Imager sans le cerveau, projet déduit des mots', async () => {
    const state: FakeImages = { enabled: true, generated: [] };
    const h = harness(state, { orchestra: true });
    await h.turn("Imager, un sticker de renard pour Driver's Ink");
    await h.turn('Jarvis, génère une image de Hinata de Naruto en style anime');
    expect(h.requests).toHaveLength(0);
    expect(state.generated).toEqual([
      { prompt: "un sticker de renard pour Driver's Ink", negative: '', project: 'drivers-ink' },
      { prompt: 'génère une image de Hinata de Naruto en style anime', negative: '', project: 'perso' },
    ]);
  });

  it('/image sans texte : réponse fixe, rien n’est généré', async () => {
    const state: FakeImages = { enabled: true, generated: [] };
    const h = harness(state);
    const { events } = await h.turn('/image');
    expect(state.generated).toEqual([]);
    expect(events.filter((event) => event.type === 'delta').map((event) => (event as { text: string }).text).join('')).toContain('Écris ta consigne après /image');
  });

  it('échec d’Imager : erreur dite dans la discussion, modèle jamais appelé', async () => {
    const state: FakeImages = { enabled: true, generated: [], fail: 'Forge n’a pas démarré en quatre minutes.' };
    const h = harness(state);
    const { events } = await h.turn('/image a cat');
    expect(h.requests).toHaveLength(0);
    const result = events.find((event): event is Extract<ChatEvent, { type: 'tool_result' }> => event.type === 'tool_result');
    expect(result?.status).toBe('error');
    expect(result?.content).toContain('Forge n’a pas démarré');
  });

  it('module coupé : « /image » est un message ordinaire pour le modèle', async () => {
    const state: FakeImages = { enabled: false, generated: [] };
    const h = harness(state);
    await h.turn('/image a cat');
    expect(state.generated).toEqual([]);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.lastUser).toBe('/image a cat');
  });

  it('le modèle répond sans Imager à une demande qui ressemble à une image → bouton « Envoyer à Imager »', async () => {
    const state: FakeImages = { enabled: true, generated: [] };
    // Phrase qui ressemble à une image mais ne commence par aucun déclencheur (« peux-tu me faire… »).
    const h = harness(state, { imagesTool: true });
    const { events } = await h.turn('Peux-tu me faire une image de chat sur un toit ?');
    expect(h.requests).toHaveLength(1);
    expect(state.generated).toEqual([]);
    expect(events.find((event) => event.type === 'imager_offer')).toEqual({ type: 'imager_offer', text: 'Peux-tu me faire une image de chat sur un toit ?' });
    // Une question sans rapport : pas de bouton.
    const other = await h.turn('Quelle heure est-il à Tokyo ?');
    expect(other.events.find((event) => event.type === 'imager_offer')).toBeUndefined();
  });
});
