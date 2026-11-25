import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Les yeux, étape 2, point 1 : une photo et une question sur n'importe quel sujet, dans la vraie
 * session de chat (Jarvis Test).
 * - Fenêtre : la photo jointe va aux yeux, en mémoire seulement (rien sur le disque, rien en base64
 *   dans l'historique), sans le modèle du chat du tour ordinaire.
 * - Une demande d'image (« fais-en un sticker ») reste à Jarvis Imager ; yeux coupés : chemin d'avant.
 * - iPhone : « Montrer à Jarvis » puis la question ; la photo sert une seule fois, 5 minutes au plus.
 * - Le regard lui-même : modèle de vision avec l'image, carte libérée avant, références lues
 *   cherchées sur le web, faits vérifiés, réponse du modèle du chat ou réponse sans lui.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-yeux-regarder-'));

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
const { creerYeuxPC } = await import('./yeux/yeuxPC.js');
const { YeuxStore } = await import('./yeux/store.js');
const { creerRegarder } = await import('./yeux/regarder.js');
let numero = 0;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(500).fill(7), 0xff, 0xd9]);
const JPEG_B64 = Buffer.from(JPEG).toString('base64');

afterAll(() => {
  rmSync(userData, { recursive: true, force: true });
});

function setup(options: { yeux?: Record<string, unknown>; edition?: boolean; horloge?: { t: number } } = {}) {
  const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:7b', ...(options.yeux ? { yeux: options.yeux } : {}) });
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
  numero += 1;
  const regards: { question: string; octets: Uint8Array; oral: boolean }[] = [];
  const horloge = options.horloge;
  const yeuxPC = creerYeuxPC({
    getSettings,
    editionYeux: options.edition ?? true,
    store: new YeuxStore(() => join(userData, `yeux-${numero}.json`)),
    telephone: true,
    ...(horloge ? { maintenant: () => horloge.t } : {}),
    regarder: async (entree) => {
      regards.push({ question: entree.question, octets: entree.photo.octets, oral: entree.oral });
      entree.avancement?.('Je regarde la photo…');
      entree.avancement?.('Je cherche « MAX98357A datasheet »…');
      return { texte: 'Un ampli MAX98357A.', vision: { description: '', texteLu: [], reponse: '', doutes: [], brute: false }, recherches: [], modeleVision: 'gemma3:4b', parLeChat: true };
    },
  });
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
    regarder: { garderPhotoJointe: (p) => yeuxPC.garderPhotoJointe(p), regarder: (input) => yeuxPC.regarder(input) },
  });
  let conversationId: string | null = null;
  const say = async (text: string, extra: { photo?: boolean; telephone?: boolean; nouvelle?: boolean } = {}) => {
    events.length = 0;
    await session.send(sender, {
      conversationId: extra.nouvelle ? null : conversationId,
      text,
      ...(extra.photo ? { attachments: [{ name: 'carte.jpg', mime: 'image/jpeg', dataBase64: JPEG_B64 }] } : {}),
      ...(extra.telephone ? { place: { kind: 'telephone' as const } } : {}),
    });
    const saved = await store.list();
    conversationId = saved[0]!.id;
    return (await store.get(conversationId))!.messages;
  };
  return { modelCalls, say, events, yeuxPC, regards };
}

describe('photo + question dans la fenêtre', () => {
  it('la photo va aux yeux, en mémoire seulement, sans le tour ordinaire du modèle', async () => {
    const { modelCalls, say, events, yeuxPC, regards } = setup({ yeux: { enabled: true } });
    const avant = readdirSync(userData).length;
    const messages = await say("c'est quoi ce composant ?", { photo: true });
    expect(regards).toHaveLength(1);
    expect(regards[0]!.question).toBe("c'est quoi ce composant ?");
    expect(regards[0]!.octets).toEqual(JPEG);
    expect(modelCalls).toEqual([]);
    const [question, reponse] = messages;
    expect(reponse!.content).toBe('Un ampli MAX98357A.');
    expect(question!.attachments).toBeUndefined();
    expect(question!.yeux?.camera).toBe('Photo jointe');
    expect(yeuxPC.photos.lire(question!.yeux!.photoId)?.octets).toEqual(JPEG);
    expect(JSON.stringify(messages)).not.toContain(JPEG_B64.slice(0, 40));
    // Rien d'écrit sur le disque (ni dossier de photos, ni pièce jointe).
    expect(readdirSync(userData).length).toBe(avant);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_start', toolName: 'regarder', summary: 'Je regarde la photo…' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_progress', message: 'Je cherche « MAX98357A datasheet »…' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', toolName: 'regarder', status: 'ok' }));
  });

  it('une demande d’image avec la photo reste à Imager (chemin d’avant)', async () => {
    const { say, events, regards } = setup({ yeux: { enabled: true } });
    await say('fais-en un sticker', { photo: true }).catch(() => undefined);
    expect(regards).toEqual([]);
    // Sans module images dans ce test, l'ancien chemin refuse la photo : c'est bien lui qui a répondu.
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'tool_start')).toBe(false);
  });

  it('yeux coupés ou Jarvis Live : chemin d’avant', async () => {
    for (const options of [{ yeux: { enabled: false } }, { yeux: { enabled: true }, edition: false }]) {
      const { say, regards } = setup(options);
      await say("c'est quoi ce composant ?", { photo: true }).catch(() => undefined);
      expect(regards).toEqual([]);
    }
  });

  it('sans photo, une question ordinaire va au modèle', async () => {
    const { modelCalls, say, regards } = setup({ yeux: { enabled: true } });
    await say("c'est quoi un MAX98357A ?");
    expect(regards).toEqual([]);
    expect(modelCalls).toEqual(["c'est quoi un MAX98357A ?"]);
  });
});

describe('photo + question sur l’iPhone', () => {
  it('« Montrer à Jarvis » puis la question : la photo sert une fois', async () => {
    const horloge = { t: 1_000_000 };
    const { modelCalls, say, yeuxPC, regards } = setup({ yeux: { enabled: true }, horloge });
    expect(await yeuxPC.recevoirPhotoTelephone({ octets: JPEG, type: 'image/jpeg', appareil: 'iPhone' })).toEqual({ ok: true });
    horloge.t += 30_000;
    const messages = await say('mon câblage est bon ?', { telephone: true, nouvelle: true });
    expect(regards.map((r) => r.question)).toEqual(['mon câblage est bon ?']);
    expect(messages.at(-1)!.content).toBe('Un ampli MAX98357A.');
    expect(messages.at(-2)!.yeux?.camera).toBe('iPhone');
    expect(modelCalls).toEqual([]);
    await say('Bonjour', { telephone: true });
    expect(regards).toHaveLength(1);
    expect(modelCalls).toEqual(['Bonjour']);
  });

  it('photo trop ancienne (plus de 5 minutes) : la question va au modèle', async () => {
    const horloge = { t: 1_000_000 };
    const { say, yeuxPC, regards } = setup({ yeux: { enabled: true }, horloge });
    await yeuxPC.recevoirPhotoTelephone({ octets: JPEG, type: 'image/jpeg', appareil: 'iPhone' });
    horloge.t += 6 * 60_000;
    await say("c'est quoi ?", { telephone: true, nouvelle: true });
    expect(regards).toEqual([]);
  });

  it('« montre-moi l’impression » après une photo : étape 1, pas le regard', async () => {
    const { say, yeuxPC, regards } = setup({ yeux: { enabled: true } });
    await yeuxPC.recevoirPhotoTelephone({ octets: JPEG, type: 'image/jpeg', appareil: 'iPhone' });
    await say("montre-moi l'impression", { telephone: true, nouvelle: true });
    expect(regards).toEqual([]);
  });
});

describe('le regard : vision, recherche vérifiée, réponse', () => {
  const PAGE = [
    'MAX98357A Class D Amplifier',
    'The MAX98357A is a digital pulse-code modulation (PCM) input Class D power amplifier.',
    'It operates from a 2.5V to 5.5V supply.',
  ].join('\n');

  async function fauxOllama(options: { chatEnPanne?: boolean } = {}) {
    const appels: { chemin: string; corps: Record<string, unknown> }[] = [];
    const server: Server = createServer((req, res) => {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => {
        const corps = data ? (JSON.parse(data) as Record<string, unknown>) : {};
        appels.push({ chemin: req.url ?? '', corps });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }));
        if (req.url === '/api/generate') return res.end(JSON.stringify({ done: true }));
        const model = corps.model as string;
        const messages = corps.messages as { role: string; content: string }[];
        let content = '';
        if (model === 'gemma3:4b') {
          content = JSON.stringify({ description: 'Une petite carte violette.', texte_lu: ['MAX98357A', 'GAIN', 'VIN'], reponse: 'Un ampli audio.', doutes: ['photo un peu floue'] });
        } else if (corps.format === 'json') {
          content = JSON.stringify({ faits: [{ fait: "S'alimente de 2,5 à 5,5 V", extrait: 'It operates from a 2.5V to 5.5V supply.' }, { fait: 'Donne 10 W', extrait: 'It operates from a 2.5V' }] });
        } else {
          if (options.chatEnPanne) {
            res.statusCode = 500;
            return res.end('{}');
          }
          content = `Réponse écrite (${messages.at(-1)!.content.includes("d'après analog.com") ? 'avec la source' : 'sans source'}).`;
        }
        res.end(JSON.stringify({ message: { content } }));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { appels, url, fermer: () => new Promise<void>((done) => server.close(() => done())) };
  }

  function regarderAvec(url: string) {
    const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:7b', baseUrl: url });
    return creerRegarder({
      getSettings: () => settings,
      searchRegistry: core.createDefaultSearchRegistry(),
      recherche: {
        chercher: async () => ['https://www.analog.com/max98357a', 'https://exemple.fr/autre'],
        lire: async (u) => (u.includes('analog') ? PAGE : 'Une page sur autre chose.'),
      },
    });
  }

  const photo = { octets: JPEG, type: 'image/jpeg' as const, prisA: 0, taille: JPEG.byteLength, camera: 'Photo jointe' };

  it('carte libérée, image envoyée au modèle de vision, faits vérifiés seulement, réponse du chat', async () => {
    const o = await fauxOllama();
    try {
      const r = await regarderAvec(o.url)({ photo, question: 'je peux le brancher en 5 V ?', oral: false });
      const decharge = o.appels.find((a) => a.chemin === '/api/generate');
      expect(decharge?.corps).toMatchObject({ model: 'qwen2.5:7b', keep_alive: 0 });
      const vision = o.appels.find((a) => a.corps.model === 'gemma3:4b')!;
      expect(o.appels.indexOf(decharge!)).toBeLessThan(o.appels.indexOf(vision));
      expect(vision.corps.keep_alive).toBe(0);
      const images = (vision.corps.messages as { images?: string[] }[])[1]!.images;
      expect(images).toEqual([JPEG_B64]);
      expect(r.recherches.map((x) => x.reference)).toEqual(['MAX98357A']);
      expect(r.recherches[0]!.faits.map((f) => f.fait)).toEqual(["S'alimente de 2,5 à 5,5 V"]);
      expect(r.parLeChat).toBe(true);
      expect(r.texte).toContain('Réponse écrite (avec la source).');
      expect(r.texte).toContain(core.RAPPEL_SECURITE);
      expect(r.texte).toContain('- https://www.analog.com/max98357a');
      expect(r.texte).toContain('gemma3:4b');
    } finally {
      await o.fermer();
    }
  });

  it('modèle du chat en panne : réponse assemblée sans lui, rien d’inventé', async () => {
    const o = await fauxOllama({ chatEnPanne: true });
    try {
      const r = await regarderAvec(o.url)({ photo, question: "c'est quoi ?", oral: false });
      expect(r.parLeChat).toBe(false);
      expect(r.texte).toContain('Un ampli audio.');
      expect(r.texte).toContain("MAX98357A : S'alimente de 2,5 à 5,5 V (d'après analog.com)");
      expect(r.texte).not.toContain('10 W');
    } finally {
      await o.fermer();
    }
  });
});
