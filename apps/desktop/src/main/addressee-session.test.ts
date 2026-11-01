import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SendChatInput } from '../shared/ipc.js';

/**
 * 5.0.62 — une phrase dite sans « Jarvis » pendant la discussion vocale : la session vérifie
 * qu'elle lui est adressée avant de lancer un tour. Rien ne change pour le texte tapé, pour la
 * première commande après « Jarvis », ni quand la vérification est coupée.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-addressee-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.62', isPackaged: false },
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
  system: string;
  lastUser: string;
}

async function turn(input: Omit<SendChatInput, 'conversationId'>, judge: string, voice: Record<string, unknown> = {}) {
  const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:7b', voice });
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
        system: request.system ?? '',
        lastUser: request.messages.at(-1)?.content ?? '',
      });
      const asking = (request.system ?? '') === core.ADDRESSEE_SYSTEM_PROMPT;
      yield { type: 'text' as const, delta: asking ? judge : 'Très bien.' };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
  const events: ChatEvent[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, event: ChatEvent) => events.push(event),
  } as unknown as Electron.WebContents;
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
  });
  await session.send(sender, { conversationId: null, ...input });
  const asked = requests.filter((request) => request.system === core.ADDRESSEE_SYSTEM_PROMPT);
  const answered = requests.filter((request) => request.system !== core.ADDRESSEE_SYSTEM_PROMPT);
  return { events, asked, answered, saved: await store.list() };
}

describe('vérification du destinataire (5.0.62)', () => {
  it('phrase de suivi pour quelqu’un d’autre : not_addressed, aucun tour, rien enregistré', async () => {
    const { events, asked, answered, saved } = await turn(
      { text: 'Chérie, tu as vu mes clés ?', source: 'voice', followUp: true },
      'non',
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]!.lastUser).toContain('« Chérie, tu as vu mes clés ? »');
    expect(answered).toHaveLength(0);
    expect(events).toEqual([{ type: 'not_addressed', text: 'Chérie, tu as vu mes clés ?' }]);
    expect(saved).toHaveLength(0);
  });

  it('le modèle dit oui : le tour part normalement', async () => {
    const { events, asked, answered } = await turn(
      { text: 'Franchement, c’est une bonne idée', source: 'voice', followUp: true },
      'oui',
    );
    expect(asked).toHaveLength(1);
    expect(answered).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(['started', 'delta', 'done']);
  });

  it('un ordre clair ne demande rien au modèle', async () => {
    const { asked, answered } = await turn({ text: 'Baisse le son', source: 'voice', followUp: true }, 'non');
    expect(asked).toHaveLength(0);
    expect(answered).toHaveLength(1);
  });

  it('réponse illisible du modèle : on répond quand même', async () => {
    const { asked, answered } = await turn(
      { text: 'Franchement, c’est une bonne idée', source: 'voice', followUp: true },
      '<think>',
    );
    expect(asked).toHaveLength(1);
    expect(answered).toHaveLength(1);
  });

  it('vérification coupée dans les réglages : tout part, comme avant', async () => {
    const { asked, answered } = await turn(
      { text: 'Chérie, tu as vu mes clés ?', source: 'voice', followUp: true },
      'non',
      { addresseeCheck: false },
    );
    expect(asked).toHaveLength(0);
    expect(answered).toHaveLength(1);
  });

  it('texte tapé ou première commande après « Jarvis » : jamais vérifiés', async () => {
    for (const input of [
      { text: 'Chérie, tu as vu mes clés ?' },
      { text: 'Chérie, tu as vu mes clés ?', source: 'voice' as const },
    ]) {
      const { asked, answered } = await turn(input, 'non');
      expect(asked).toHaveLength(0);
      expect(answered).toHaveLength(1);
    }
  });
});
