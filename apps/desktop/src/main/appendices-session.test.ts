import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Socle des appendices dans la vraie session de chat :
 * - « Jarvis, arrête tout » arrête les appendices sans appeler aucun modèle ;
 * - sans la fonction (Jarvis Live) ou sans rien à arrêter, la phrase suit le chemin d'avant ;
 * - sans appendice relié, le catalogue d'outils vu par le modèle est celui d'avant.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-appendices-session-'));

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
const { AppendiceService } = await import('./appendices/service.js');
const { AppendiceStore } = await import('./appendices/store.js');
const { startFakeAppendice } = await import('./appendices/fakeAppendice.testkit.js');
const { APPENDICES_STOP_TOOL } = await import('./tools/appendices.js');

type Fake = Awaited<ReturnType<typeof startFakeAppendice>>;
const fakes: Fake[] = [];
let counter = 0;

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((fake) => fake.close().catch(() => undefined)));
});
afterAll(() => rmSync(userData, { recursive: true, force: true }));

const cipher = {
  available: () => true,
  seal: (plain: string) => Buffer.from(plain, 'utf8').toString('base64'),
  open: (sealed: string) => Buffer.from(sealed, 'base64').toString('utf8'),
};

async function setup(options: { allowed?: boolean; link?: boolean; wired?: boolean } = {}) {
  counter += 1;
  const dir = join(userData, `cas-${counter}`);
  const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:7b' });
  const getSettings = () => settings;
  const service = new AppendiceService(AppendiceStore.inUserData(() => dir), { allowed: options.allowed ?? true, cipher });
  await service.load();
  const fake = await startFakeAppendice();
  fakes.push(fake);
  if (options.link ?? true) {
    await service.setEnabled(true);
    await service.add({ baseUrl: fake.origin, token: fake.token });
  }
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
    appendices: service,
  });
  const events: ChatEvent[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
  const store = new core.InMemoryConversationStore();
  // Même fonction que dans `main/index.ts` : règle, puis l'outil d'arrêt.
  const stopAll = async (input: { text: string }): Promise<string | null> => {
    if (!core.isStopAllPhrase(input.text) || !service.canStop()) return null;
    const outcome = await tools.execute(
      { id: 'arret', name: APPENDICES_STOP_TOOL, arguments: {} },
      { requestConfirmation: async () => false },
    );
    return outcome.content || null;
  };
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
    ...((options.wired ?? true) ? { stopAll } : {}),
  });
  const say = async (text: string) => {
    events.length = 0;
    await session.send(sender, { conversationId: null, text });
    const saved = await store.list();
    const last = saved.length ? await store.get(saved[0]!.id) : null;
    return last?.messages.filter((message) => message.role === 'assistant').at(-1)?.content ?? '';
  };
  return { fake, service, tools, modelCalls, say, events };
}

describe('« arrête tout » dans la session', () => {
  it('arrête l’appendice sans appeler de modèle, et le dit', async () => {
    const { fake, modelCalls, say } = await setup();
    const reply = await say('Jarvis, arrête tout !');
    expect(reply).toBe('Arrêt envoyé : Faux bras (établi).');
    expect(fake.stops).toBe(1);
    expect(modelCalls).toEqual([]);
  });

  it('appendice muet : la réponse le nomme et renvoie au bouton physique, toujours sans modèle', async () => {
    const { fake, modelCalls, say } = await setup();
    fake.mute = true;
    const reply = await say('Arrête tout');
    expect(reply).toContain('Pas de réponse de Faux bras (établi)');
    expect(reply).toContain('bouton d’arrêt d’urgence');
    expect(modelCalls).toEqual([]);
  });

  it('une autre phrase n’est pas un arrêt général', async () => {
    const { fake, modelCalls, say } = await setup();
    expect(await say('Arrête tout de suite de me vouvoyer')).toBe('Réponse du modèle.');
    expect(fake.stops).toBe(0);
    expect(modelCalls).toHaveLength(1);
  });

  it('rien à arrêter : la phrase suit le chemin d’avant', async () => {
    const { fake, modelCalls, say } = await setup({ link: false });
    expect(await say('Arrête tout')).toBe('Réponse du modèle.');
    expect(fake.requests).toEqual([]);
    expect(modelCalls).toHaveLength(1);
  });

  it('Jarvis Live (fonction absente) : la phrase suit le chemin d’avant, aucun appendice n’est joint', async () => {
    const { fake, modelCalls, say } = await setup({ allowed: false, wired: false });
    expect(await say('Arrête tout')).toBe('Réponse du modèle.');
    expect(fake.requests).toEqual([]);
    expect(modelCalls).toHaveLength(1);
  });
});

describe('catalogue du chat et appendices', () => {
  const PROFILES = {
    complet: {},
    modeste: { machine: { profile: 'modest', cpuOnly: true, measureFailed: false, detected: '8 Go', chosen: 'modeste' } },
  };

  function catalog(values: Record<string, unknown>, appendices?: InstanceType<typeof AppendiceService>) {
    const settings = core.parseSettings(values);
    const getSettings = () => settings;
    return createToolManager({
      getSettings,
      searchRegistry: core.createDefaultSearchRegistry(),
      marketDataRegistry: core.createDefaultMarketDataRegistry(),
      spotify: new SpotifyBridge(getSettings),
      siteBlock: new SiteBlockBridge(getSettings),
      personalization: new PersonalizationStore(),
      knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
      ...(appendices ? { appendices } : {}),
    });
  }

  it.each(Object.entries(PROFILES))('profil %s : sans appendice relié, le modèle voit exactement le catalogue d’avant', async (_label, base) => {
    const before = catalog(base).schemas();
    const { service: empty } = await setup({ link: false });
    expect(catalog(base, empty).schemas()).toEqual(before);
    const { service: live } = await setup({ allowed: false });
    expect(catalog(base, live).schemas()).toEqual(before);
    expect(before.some((schema) => schema.name.startsWith('appendice'))).toBe(false);
  });

  it.each(Object.entries(PROFILES))('profil %s : un appendice relié ajoute ses outils en fin de catalogue, rien d’autre ne bouge', async (_label, base) => {
    const before = catalog(base).schemas();
    const { service } = await setup();
    const after = catalog(base, service).schemas();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map((schema) => schema.name)).toEqual([
      'appendices_etat',
      'appendice_action',
      'appendices_stop',
      'appendice_arret_urgence',
      'appendice_relacher_urgence',
    ]);
  });

  it('avec le chef d’orchestre, seule l’équipe PC reçoit les outils des appendices', () => {
    for (const team of core.ORCHESTRA_TEAMS) {
      expect(core.teamHasTool(team, 'appendice_action'), team).toBe(team === 'pc');
      expect(core.teamHasTool(team, 'appendices_stop'), team).toBe(team === 'pc');
    }
  });
});
