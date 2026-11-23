import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Les yeux de Jarvis dans la vraie session de chat (Jarvis Test) :
 * - « montre-moi l'impression » répond sans modèle, la photo reste en mémoire et seule sa
 *   référence est posée sur la réponse enregistrée (jamais l'image dans l'historique) ;
 * - depuis une enceinte : phrase courte, la photo va dans la discussion du PC ;
 * - coupé, sans imprimante, ou dans Jarvis Live : le tour suit le chemin d'avant ;
 * - seules des requêtes GET partent vers l'imprimante.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-yeux-session-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.1.0', isPackaged: false },
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
const { creerYeuxPC, PhotosEnMemoire, yeuxActifs } = await import('./yeux/yeuxPC.js');

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(3000).fill(9), 0xff, 0xd9]);
const methodes: string[] = [];
const server: Server = createServer((req, res) => {
  methodes.push(req.method ?? '');
  const url = req.url ?? '';
  res.setHeader('content-type', 'application/json');
  if (url.startsWith('/server/webcams/list')) {
    const port = (server.address() as AddressInfo).port;
    res.end(JSON.stringify({ result: { webcams: [{ name: 'cam', enabled: true, snapshot_url: `http://127.0.0.1:${port}/snap` }] } }));
  } else if (url.startsWith('/printer/objects/query')) {
    res.end(
      JSON.stringify({
        result: {
          status: {
            print_stats: { state: 'printing', filename: 'bac.gcode', print_duration: 3000 },
            virtual_sdcard: { progress: 0.5 },
            extruder: { temperature: 255, target: 255 },
            heater_bed: { temperature: 80, target: 80 },
            webhooks: { state: 'ready' },
          },
        },
      }),
    );
  } else if (url.startsWith('/snap')) {
    res.setHeader('content-type', 'image/jpeg');
    res.end(Buffer.from(JPEG));
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(userData, { recursive: true, force: true });
});

function setup(options: { yeux?: Record<string, unknown> | undefined; edition?: boolean } = {}) {
  const settings = core.parseSettings({
    provider: 'ollama',
    model: 'qwen2.5:7b',
    printer: { baseUrl: base },
    ...(options.yeux !== undefined ? { yeux: options.yeux } : {}),
  });
  const getSettings = () => settings;
  const modelCalls: string[] = [];
  const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request) {
      modelCalls.push(request.messages.at(-1)?.content ?? '');
      yield { type: 'text' as const, delta: 'Réponse du modèle.' };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
  const tools = createToolManager({
    getSettings,
    searchRegistry: core.createDefaultSearchRegistry(),
    marketDataRegistry: core.createDefaultMarketDataRegistry(),
    spotify: new SpotifyBridge(getSettings),
    siteBlock: new SiteBlockBridge(getSettings),
    personalization: new PersonalizationStore(),
    knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
  });
  const events: ChatEvent[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
  const store = new core.InMemoryConversationStore();
  const yeuxPC = creerYeuxPC(getSettings, options.edition ?? true);
  const session = new ChatSession({
    registry,
    tools,
    store,
    auditLog: new core.InMemoryAuditLogStore(),
    getSettings,
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => core.emptyPersonalization() } as never,
    knowledge: { indexConversation: async () => 0 } as never,
    localLearning: { recordTurn: async () => undefined } as never,
    yeux: (input) => yeuxPC.tour(input),
  });
  const say = async (text: string, place?: { kind: 'enceinte'; name: string }) => {
    events.length = 0;
    await session.send(sender, { conversationId: null, text, ...(place ? { place } : {}) });
    const saved = await store.list();
    return (await store.get(saved[0]!.id))!.messages;
  };
  return { modelCalls, say, events, yeuxPC };
}

describe('les yeux dans la session', () => {
  it('« montre-moi l’impression » : sans modèle, photo en mémoire, sa référence seule dans la discussion', async () => {
    methodes.length = 0;
    const { modelCalls, say, events, yeuxPC } = setup({ yeux: { enabled: true } });
    const messages = await say("Jarvis, montre-moi l'impression");
    expect(modelCalls).toEqual([]);
    const reponse = messages.at(-1)!;
    expect(reponse.content).toMatch(/^50 %, il reste 50 min, buse 255 °C, plateau 80 °C\. Photo prise à \d+ h \d{2} min \d{2} s\.$/);
    expect(reponse.yeux?.camera).toBe('cam');
    expect(Object.keys(reponse.yeux!).sort()).toEqual(['camera', 'photoId', 'prisA']);
    expect(JSON.stringify(messages)).not.toMatch(/base64|\/9j\//);
    expect(events).toContainEqual({ type: 'yeux', messageId: reponse.id, photo: reponse.yeux });
    const photo = yeuxPC.photos.lire(reponse.yeux!.photoId);
    expect(photo?.octets).toEqual(JPEG);
    expect(new Set(methodes)).toEqual(new Set(['GET']));
  });

  it('enceinte : phrase courte, la photo est dans la discussion du PC', async () => {
    const { say } = setup({ yeux: { enabled: true } });
    const messages = await say("Montre-moi l'impression", { kind: 'enceinte', name: 'Salon' });
    expect(messages.at(-1)!.content).toBe('50 %, il reste 50 min. La photo est sur le PC.');
    expect(messages.at(-1)!.yeux).toBeDefined();
  });

  it('coupé, absent ou Jarvis Live : chemin d’avant', async () => {
    for (const options of [{ yeux: { enabled: false } }, { yeux: undefined }, { yeux: { enabled: true }, edition: false }]) {
      methodes.length = 0;
      const { modelCalls, say } = setup(options);
      const messages = await say("Montre-moi l'impression");
      expect(messages.at(-1)!.yeux).toBeUndefined();
      expect(modelCalls.length).toBe(1);
      expect(methodes).toEqual([]);
    }
  });

  it('une autre phrase va au modèle, sans toucher à l’imprimante', async () => {
    methodes.length = 0;
    const { modelCalls, say } = setup({ yeux: { enabled: true } });
    await say('Bonjour');
    expect(modelCalls).toEqual(['Bonjour']);
    expect(methodes).toEqual([]);
  });

  it('réglages : sans défaut, et adresse hors réseau local refusée', () => {
    expect('yeux' in core.parseSettings({})).toBe(false);
    const loin = core.parseSettings({ printer: { baseUrl: 'http://8.8.8.8' }, yeux: { enabled: true } });
    expect(yeuxActifs(loin, true)).toBe(false);
  });

  it('photos en mémoire : 30 minutes, 20 au plus', () => {
    let t = 1_000_000;
    const photos = new PhotosEnMemoire(() => t, 2, 1000);
    const photo = (prisA: number) => ({ octets: JPEG, type: 'image/jpeg' as const, prisA, taille: JPEG.length, camera: 'cam' });
    const a = photos.garder(photo(t));
    const b = photos.garder(photo(t));
    const c = photos.garder(photo(t));
    expect(photos.lire(a.photoId)).toBeNull();
    expect(photos.lire(b.photoId)).not.toBeNull();
    t += 1001;
    expect(photos.lire(c.photoId)).toBeNull();
  });
});
