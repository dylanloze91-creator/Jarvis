import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { LearningRecord } from '@jarvis/core';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Corrections pour la Live 5.0.80, dans une vraie session de chat avec le chef d'orchestre :
 * la règle express à outil « les informations sur mon PC », et une phrase en « non » qui répond à
 * une question de Jarvis (elle attend l'accord au lieu de devenir une règle).
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-5080-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.80', isPackaged: false },
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

const settings = core.parseSettings({
  provider: 'ollama',
  model: 'qwen2.5:3b',
  orchestra: { enabled: true, brain: 'qwen2.5:7b' },
});
const getSettings = () => settings;

function build(options: { reply?: string; breakTool?: boolean } = {}) {
  const requests: Array<{ system: string; tools: string[] }> = [];
  const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request) {
      requests.push({ system: request.system ?? '', tools: (request.tools ?? []).map((tool) => tool.name) });
      const router = (request.system ?? '').includes('chef d’orchestre');
      yield { type: 'text' as const, delta: router ? 'conversation' : (options.reply ?? 'Très bien.') };
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
  if (options.breakTool) {
    const realExecute = tools.execute.bind(tools);
    tools.execute = async (call, context) => {
      if (call.name === 'get_system_info') throw new Error('outil en panne');
      return realExecute(call, context);
    };
  }
  const audit = new core.InMemoryAuditLogStore();
  const learned: Array<LearningRecord | null> = [];
  const session = new ChatSession({
    registry,
    tools,
    store: new core.InMemoryConversationStore(),
    auditLog: audit,
    getSettings,
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => core.emptyPersonalization() } as never,
    knowledge: {
      indexConversation: async () => 0,
      applyLearning: async (record: LearningRecord | null) => {
        learned.push(record);
        return [];
      },
      promptLearning: async () => [],
    } as never,
    localLearning: { recordTurn: async () => undefined } as never,
  });
  const say = async (text: string, conversationId: string | null = null) => {
    const events: ChatEvent[] = [];
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, event: ChatEvent) => events.push(event),
    } as unknown as Electron.WebContents;
    await session.send(sender, { conversationId, text });
    const reply = events
      .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    const done = events.find((event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done');
    const route = events.find((event): event is Extract<ChatEvent, { type: 'route' }> => event.type === 'route');
    const toolsShown = events.filter((event) => event.type === 'tool_start').length;
    return { reply, route, conversationId: done?.conversationId ?? conversationId, messages: done?.messages ?? [], toolsShown };
  };
  return { say, requests, audit, learned };
}

describe('règle express à outil : les informations sur mon PC', () => {
  it('appelle get_system_info sans aucun modèle et rend son résultat', async () => {
    const jarvis = build();
    const { reply, route, messages, toolsShown } = await jarvis.say('Donne-moi les informations sur mon PC');
    expect(jarvis.requests).toHaveLength(0);
    // La discussion garde l'appel et son résultat, comme si le modèle avait appelé l'outil :
    // sans cette trace, le modèle répondait ensuite sans outil à la demande suivante.
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(messages[1]?.toolCalls?.[0]?.name).toBe('get_system_info');
    expect(messages[2]?.toolName).toBe('get_system_info');
    expect(toolsShown).toBe(1);
    expect(route?.team).toBe('pc');
    expect(route?.how).toBe('express');
    expect(reply).toContain('Voici les informations du PC');
    expect(reply).toMatch(/- Mémoire : .+ utilisés sur /);
    expect(reply).toMatch(/- Processeur : /);
    const entries = await jarvis.audit.list();
    expect(entries.map((entry) => entry.toolName)).toEqual(['get_system_info']);
  });

  it('laisse au modèle une demande que la règle ne prend pas', async () => {
    const jarvis = build();
    await jarvis.say('Pourquoi l’état de mon PC est aussi lent ?');
    expect(jarvis.requests.length).toBeGreaterThan(0);
    expect((await jarvis.audit.list()).map((entry) => entry.toolName)).not.toContain('get_system_info');
  });

  it('outil en panne : l’équipe PC répond avec son modèle, rien n’est inventé par la règle', async () => {
    const jarvis = build({ breakTool: true });
    const { reply, route } = await jarvis.say('Donne-moi les informations sur mon PC');
    expect(route?.team).toBe('pc');
    expect(jarvis.requests).toHaveLength(1);
    expect(jarvis.requests[0]?.tools).toContain('get_system_info');
    expect(reply).toBe('Très bien.');
  });
});

describe('mémoire apprise : « non » après une question de Jarvis', () => {
  it('attend l’accord quand Jarvis venait de poser une question, reste une correction sinon', async () => {
    const jarvis = build({ reply: 'Je peux aussi fermer la cuisine le mardi. Tu veux ?' });
    const first = await jarvis.say('Parle-moi des horaires de la cuisine.');
    await jarvis.say('Non, la cuisine reste fermée le lundi.', first.conversationId);
    expect(jarvis.learned.at(-1)?.status).toBe('candidate');

    const neuf = build();
    await neuf.say('Non, la cuisine reste fermée le lundi.');
    expect(neuf.learned.at(-1)?.status).toBe('validated');
  });
});
