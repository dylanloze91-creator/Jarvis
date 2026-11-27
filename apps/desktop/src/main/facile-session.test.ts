import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SendChatInput } from '../shared/ipc.js';
import type { ChatMissionHub } from './chatMission/hub.js';
import type { FacileCoordinator } from './chatMission/facile.js';

/**
 * Jarvis Développeur facile dans une vraie session de chat : une demande de création reçoit sa
 * phrase tout de suite, sans aucun modèle, et la création part une fois la discussion enregistrée.
 * Sans le coordinateur (Jarvis Live), la même phrase suit le chemin d'avant.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-facile-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => 'test', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

import type { ChatMissionEnvelope } from '@jarvis/core';
const core = await import('@jarvis/core');
const { createToolManager } = await import('./tools/index.js');
const { ChatSession } = await import('./session.js');
const { SpotifyBridge } = await import('./media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('./siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('./personalization.js');
const { KnowledgeStore } = await import('./knowledge.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

const settings = core.parseSettings({
  provider: 'ollama',
  model: 'qwen2.5:3b',
  orchestra: { enabled: true, brain: 'qwen2.5:7b' },
  developer: { enabled: true },
});
const getSettings = () => settings;

const DEMANDE = 'Fais-moi une petite appli pour noter mes heures de chantier';

function build(options: {
    suivi?: (text: string, where: { voice: boolean; speaker: boolean }) => { text: string; envelope?: ChatMissionEnvelope } | null; facile?: boolean; busy?: boolean; hubEnabled?: boolean; atelier?: boolean } = {}) {
  let modelCalls = 0;
  /** Phrases que l'atelier 3D a reçues (il répond à tout ce qu'on lui donne). */
  const atelierAsked: string[] = [];
  const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request) {
      modelCalls += 1;
      const router = (request.system ?? '').includes('chef d’orchestre');
      yield { type: 'text' as const, delta: router ? 'code' : 'Très bien.' };
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
  const store = new core.InMemoryConversationStore();
  /** Ce que la discussion enregistrée contenait au moment où la création a démarré. */
  const savedAtStart: Array<{ conversationId: string; messageId: string; cardSaved: boolean }> = [];
  const pending: Array<Promise<void>> = [];
  const facile = {
    busy: () => options.busy === true,
    // Étape 3 : le suivi (« où en est mon appli ? », « mes applis »), par règles ; `null` : pas pour lui.
    suivi: async (text: string, where: { voice: boolean; speaker: boolean }) => options.suivi?.(text, where) ?? null,
    prepare: (request: Parameters<FacileCoordinator['prepare']>[0], voice: boolean) =>
      core.newFacilePayload({ id: 'creation-1', request, now: 1, voice }),
    start: (conversationId: string, messageId: string) => {
      pending.push(
        store.get(conversationId).then((conversation) => {
          savedAtStart.push({
            conversationId,
            messageId,
            cardSaved: Boolean(conversation?.messages.some((message) => message.id === messageId)),
          });
        }),
      );
    },
  } as unknown as FacileCoordinator;
  const hub = {
    enabled: () => options.hubEnabled !== false,
    missionBusy: () => false,
    knownProjectNames: () => [],
    setConversationContext: () => undefined,
    unbindMissionMessage: () => undefined,
    bindMissionMessage: () => undefined,
    recordProposal: () => {
      throw new Error('aucune carte de proposition attendue');
    },
  } as unknown as ChatMissionHub;
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
    getChatMissionHub: () => hub,
    ...(options.facile === false ? {} : { getFacile: () => facile }),
    ...(options.atelier
      ? {
          atelier: async (input: { text: string }) => {
            atelierAsked.push(input.text);
            return { texte: 'Voici la pièce.' };
          },
        }
      : {}),
  });
  const say = async (text: string, extra: Partial<SendChatInput> = {}) => {
    const events: ChatEvent[] = [];
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, event: ChatEvent) => events.push(event),
    } as unknown as Electron.WebContents;
    await session.send(sender, { conversationId: null, text, ...extra });
    await Promise.all(pending);
    const reply = events
      .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    const card = events.find((event): event is Extract<ChatEvent, { type: 'mission_card' }> => event.type === 'mission_card');
    const route = events.find((event): event is Extract<ChatEvent, { type: 'route' }> => event.type === 'route');
    return { reply, card, route, events };
  };
  return { say, savedAtStart, atelierAsked, calls: () => modelCalls };
}

describe('Développeur facile : réponse immédiate', () => {
  it('répond par la phrase fixe sans appeler aucun modèle, puis démarre la création', async () => {
    const jarvis = build();
    const { reply, card, route } = await jarvis.say(DEMANDE);
    expect(jarvis.calls()).toBe(0);
    expect(reply).toBe(core.FACILE_IMMEDIATE_REPLY);
    expect(route).toMatchObject({ team: 'code', how: 'mission-directe', model: 'sans modèle' });
    const envelope = card?.message.chatMission;
    expect(envelope?.kind).toBe('facile');
    if (envelope?.kind !== 'facile') throw new Error('carte absente');
    expect(envelope.data.restatement).toBe('Si j’ai bien compris : une petite appli pour noter mes heures de chantier.');
    expect(envelope.data.voice).toBe(false);
    // La création ne démarre qu'une fois sa carte enregistrée dans la discussion.
    expect(jarvis.savedAtStart).toEqual([
      { conversationId: expect.any(String), messageId: card?.message.id, cardSaved: true },
    ]);
  });

  it('demande venue de la voix : la carte le note, pour dire les moments importants', async () => {
    const jarvis = build();
    const { card } = await jarvis.say(DEMANDE, { source: 'voice' });
    const envelope = card?.message.chatMission;
    expect(envelope?.kind === 'facile' && envelope.data.voice).toBe(true);
  });

  it('depuis une enceinte : Jarvis répond et ne lance jamais la création', async () => {
    const jarvis = build();
    const { reply, card } = await jarvis.say(DEMANDE, { source: 'voice', place: { kind: 'enceinte', name: 'salon' } as never });
    expect(reply).toBe(core.FACILE_SPEAKER_REPLY);
    expect(card).toBeUndefined();
    expect(jarvis.savedAtStart).toEqual([]);
    expect(jarvis.calls()).toBe(0);
  });

  it('une création tourne déjà : Jarvis le dit, sans en lancer une seconde', async () => {
    const jarvis = build({ busy: true });
    const { reply, card } = await jarvis.say(DEMANDE);
    expect(reply).toBe(core.FACILE_BUSY_REPLY);
    expect(card).toBeUndefined();
    expect(jarvis.savedAtStart).toEqual([]);
  });

  it('une phrase qui n’est pas une création suit le chemin habituel', async () => {
    const jarvis = build();
    const { card } = await jarvis.say('Comment créer une application sur Windows ?');
    expect(card).toBeUndefined();
    expect(jarvis.calls()).toBeGreaterThan(0);
    expect(jarvis.savedAtStart).toEqual([]);
  });
});

describe('Développeur facile : réservé à Jarvis Test', () => {
  it('sans coordinateur (Jarvis Live), la demande suit le chemin d’avant : le cerveau trie', async () => {
    const jarvis = build({ facile: false, hubEnabled: false });
    const { reply, card } = await jarvis.say(DEMANDE);
    expect(card).toBeUndefined();
    expect(reply).not.toBe(core.FACILE_IMMEDIATE_REPLY);
    expect(jarvis.calls()).toBeGreaterThan(0);
  });

  it('mode Développeur coupé : rien ne démarre', async () => {
    const jarvis = build({ hubEnabled: false });
    const { card } = await jarvis.say(DEMANDE);
    expect(card).toBeUndefined();
    expect(jarvis.savedAtStart).toEqual([]);
  });
});

describe('Développeur facile, étape 3 : le suivi dans la discussion', () => {
  it('« où en est mon appli ? » : réponse par règles, sans modèle, sans passer par l’atelier', async () => {
    const vus: Array<{ text: string; speaker: boolean }> = [];
    const jarvis = build({
      atelier: true,
      suivi: (text, where) => {
        vus.push({ text, speaker: where.speaker });
        return /appli/.test(text) ? { text: 'Je construis ton appli : je démarre.' } : null;
      },
    });
    const { reply, card, route } = await jarvis.say('où en est mon appli ?');
    expect(reply).toBe('Je construis ton appli : je démarre.');
    expect(card).toBeUndefined();
    expect(route).toMatchObject({ team: 'code', how: 'mission-directe', model: 'sans modèle' });
    expect(jarvis.calls()).toBe(0);
    expect(jarvis.atelierAsked).toEqual([]);
    // Une phrase qui n'est pas pour le suivi suit son chemin (ici : l'atelier).
    expect((await jarvis.say('fais-moi une boîte de 80 par 50 par 30')).reply).toBe('Voici la pièce.');
    expect(vus.map((v) => v.speaker)).toEqual([false, false]);
  });

  it('« mes applis » : la phrase, puis la carte de la liste', async () => {
    const jarvis = build({ suivi: () => ({ text: 'Voici ton appli :', envelope: { kind: 'facile-applis', data: { apps: [] } } }) });
    const { reply, card } = await jarvis.say('mes applis');
    expect(reply).toBe('Voici ton appli :');
    expect(card?.message.chatMission?.kind).toBe('facile-applis');
    expect(jarvis.calls()).toBe(0);
  });

  it('un suivi qui lève une erreur ne casse pas le tour', async () => {
    const jarvis = build({
      atelier: true,
      suivi: () => {
        throw new Error('fichier illisible');
      },
    });
    expect((await jarvis.say('fais-moi une boîte de 80 par 50 par 30')).reply).toBe('Voici la pièce.');
  });
});

describe('Développeur facile et atelier 3D dans la même discussion', () => {
  it('« une appli qui dessine des boîtes » est une création : l’atelier ne reçoit pas la phrase', async () => {
    const jarvis = build({ atelier: true });
    for (const phrase of [
      'fais-moi une appli qui dessine des boîtes',
      'fabrique-moi un convertisseur de millimètres en pouces',
      'crée un site pour présenter mes boîtiers',
      'fais moi une appli de suivi de commandes pour mon atelier de stickers',
    ]) {
      const { reply, card } = await jarvis.say(phrase);
      expect(reply, phrase).toBe(core.FACILE_IMMEDIATE_REPLY);
      expect(card, phrase).toBeDefined();
    }
    expect(jarvis.atelierAsked).toEqual([]);
    expect(jarvis.calls()).toBe(0);
  });

  it('une pièce reste à l’atelier : pas de carte de création', async () => {
    const jarvis = build({ atelier: true });
    for (const phrase of ['fais-moi une boîte de 80 par 50 par 30', 'crée-moi un boîtier pour un compteur', 'Fais-moi un minuteur de 10 minutes']) {
      const { reply, card } = await jarvis.say(phrase);
      expect(reply, phrase).toBe('Voici la pièce.');
      expect(card, phrase).toBeUndefined();
    }
    expect(jarvis.atelierAsked).toHaveLength(3);
    expect(jarvis.savedAtStart).toEqual([]);
  });

  it('sans le coordinateur (Jarvis Live), l’atelier reçoit tout comme avant', async () => {
    const jarvis = build({ atelier: true, facile: false, hubEnabled: false });
    await jarvis.say('fais-moi une appli qui dessine des boîtes');
    expect(jarvis.atelierAsked).toEqual(['fais-moi une appli qui dessine des boîtes']);
  });
});
