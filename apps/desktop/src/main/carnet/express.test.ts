import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../../shared/ipc.js';

/**
 * « Ça n'a pas marché » répond avant tout modèle.
 * Phrases synthétiques marquées synthetique-test.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-carnet-express-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.76', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { createToolManager } = await import('../tools/index.js');
const { ChatSession } = await import('../session.js');
const { SpotifyBridge } = await import('../media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('../siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('../personalization.js');
const { KnowledgeStore } = await import('../knowledge.js');
const { CarnetHub } = await import('./hub.js');

afterAll(() => rmSync(userData, { recursive: true, force: true, maxRetries: 5 }));

const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:7b' });

function tools() {
  const getSettings = () => settings;
  return createToolManager({
    getSettings,
    searchRegistry: core.createDefaultSearchRegistry(),
    marketDataRegistry: core.createDefaultMarketDataRegistry(),
    spotify: new SpotifyBridge(getSettings),
    siteBlock: new SiteBlockBridge(getSettings),
    personalization: new PersonalizationStore(),
    knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
  });
}

interface Captured {
  system?: string;
  messages: Array<{ role: string; content: string }>;
  tools: string[];
  temperature?: number;
}

function registry(requests: Captured[], mode: 'reply' | 'throw') {
  let built = 0;
  const registered = new core.ProviderRegistry().register(
    { ...core.ollamaDescriptor },
    (config) => {
      built += 1;
      return {
        id: 'ollama',
        label: 'Ollama',
        model: config.model,
        requiresApiKey: false,
        async *streamChat(request: {
          system?: string;
          messages: Array<{ role: string; content: string }>;
          tools?: Array<{ name: string }>;
          temperature?: number;
        }) {
          built += 1;
          requests.push({
            system: request.system,
            messages: request.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            tools: (request.tools ?? []).map((tool) => tool.name),
            temperature: request.temperature,
          });
          if (mode === 'throw') throw new Error('le modèle ne doit pas être appelé');
          yield { type: 'text' as const, delta: 'Très bien.' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
        },
      };
    },
  );
  return { registry: registered, built: () => built };
}

function senderOf(events: ChatEvent[]) {
  return {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
}

async function seededStore() {
  const store = new core.InMemoryConversationStore();
  const conversation = core.newConversation([
    core.createMessage('user', 'Quelle heure est-il ?'),
    core.createMessage('assistant', 'Il est 3 heures.'),
  ]);
  await store.save(conversation);
  return { store, id: conversation.id };
}

function sessionFor(
  reg: ReturnType<typeof registry>['registry'],
  store: core.ConversationStore,
  carnet: CarnetHub | undefined,
) {
  return new ChatSession({
    registry: reg,
    tools: tools(),
    store,
    auditLog: new core.InMemoryAuditLogStore(),
    getSettings: () => settings,
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => core.emptyPersonalization() } as never,
    knowledge: { indexConversation: async () => 0 } as never,
    localLearning: { recordTurn: async () => undefined } as never,
    ...(carnet ? { carnet } : {}),
  });
}

describe('carnet — ça n’a pas marché (synthetique-test)', () => {
  it.each([
    ['fenêtre', { kind: 'fenetre' as const }],
    ['enceinte Cuisine', { kind: 'enceinte' as const, name: 'Cuisine' }],
    ['téléphone', { kind: 'telephone' as const }],
  ])(
    'synthetique-test %s : « C’est noté. », tour précédent, modèle non appelé',
    async (_label, place) => {
      const requests: Captured[] = [];
      const made = registry(requests, 'throw');
      const carnet = new CarnetHub('test');
      const { store, id } = await seededStore();
      const events: ChatEvent[] = [];
      const session = sessionFor(made.registry, store, carnet);
      await session.send(senderOf(events), {
        conversationId: id,
        text: "Jarvis, ça n'a pas marché",
        source: 'voice',
        followUp: true,
        place,
      });
      expect(made.built()).toBe(0);
      expect(requests).toEqual([]);
      expect(events.some((event) => event.type === 'delta' && event.text === "C'est noté.")).toBe(
        true,
      );
      expect(carnet.noted).toHaveLength(1);
      expect(carnet.noted[0]).toMatchObject({
        place,
        detection: {
          type: 'signale',
          rule: 'signale-phrase',
          userText: 'Quelle heure est-il ?',
          replyText: 'Il est 3 heures.',
        },
      });
      const saved = await store.get(id);
      expect(saved?.messages.at(-1)?.content).toBe("C'est noté.");
    },
  );

  it('synthetique-test carnet coupé : la phrase va au modèle, rien n’est noté', async () => {
    const requests: Captured[] = [];
    const made = registry(requests, 'reply');
    const carnet = new CarnetHub('live');
    expect(carnet.enabled()).toBe(false);
    const { store, id } = await seededStore();
    const events: ChatEvent[] = [];
    await sessionFor(made.registry, store, carnet).send(senderOf(events), {
      conversationId: id,
      text: "ça n'a pas marché",
    });
    expect(made.built()).toBeGreaterThan(0);
    expect(requests.length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === 'delta' && event.text === 'Très bien.')).toBe(
      true,
    );
    expect(events.some((event) => event.type === 'delta' && event.text === "C'est noté.")).toBe(
      false,
    );
    expect(carnet.noted).toEqual([]);
  });

  it('synthetique-test les requêtes du faux Ollama sont les mêmes, carnet actif ou non', async () => {
    const phrase = 'Bonjour Jarvis, comment vas-tu ?';
    async function once(enabled: boolean): Promise<Captured[]> {
      const requests: Captured[] = [];
      const made = registry(requests, 'reply');
      const carnet = new CarnetHub('test');
      carnet.setEnabled(enabled);
      const store = new core.InMemoryConversationStore();
      await sessionFor(made.registry, store, carnet).send(senderOf([]), {
        conversationId: null,
        text: phrase,
      });
      return requests;
    }
    expect(await once(true)).toEqual(await once(false));
  });
});
