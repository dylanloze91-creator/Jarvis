import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';
import { ChatMissionHub } from './chatMission/hub.js';
import { createProposerMissionTool } from './chatMission/proposerMissionTool.js';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-chat-mission-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.68', isPackaged: false },
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
  teams: {
    code: { model: 'qwen2.5-coder:7b', place: 'processeur' as const },
  },
};

describe('missions depuis la discussion (5.0.68)', () => {
  it('équipe Code : proposer_mission dans le catalogue quand chatMissions actif', async () => {
    const settings = core.parseSettings({
      provider: 'ollama',
      model: 'qwen2.5:3b',
      orchestra: ORCHESTRA,
      developer: {
        enabled: true,
        repoPath: 'C:\\dev\\Jarvis',
        chatMissions: true,
        codeModel: 'qwen2.5-coder:7b',
      },
    });
    const getSettings = () => settings;
    const hub = new ChatMissionHub({ getSettings, developer: () => null });
    const requests: Array<{ tools: string[]; system?: string }> = [];
    const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request) {
        requests.push({
          tools: (request.tools ?? []).map((tool) => tool.name),
          system: request.system,
        });
        const router = (request.system ?? '').includes('chef d’orchestre');
        yield { type: 'text' as const, delta: router ? 'code' : '' };
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
      getChatMissionHub: () => hub,
    });
    await session.send(sender, { conversationId: null, text: 'Crée-moi un petit script Python' });
    const team = requests[1];
    expect(team?.tools).toContain('proposer_mission');
    expect(team?.system).toContain('proposer_mission');
  });

  it('appel proposer_mission : événement mission_proposal et message persisté', async () => {
    const settings = core.parseSettings({
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      orchestra: ORCHESTRA,
      developer: {
        enabled: true,
        repoPath: 'C:\\dev\\Jarvis',
        chatMissions: true,
        codeModel: 'qwen2.5-coder:7b',
      },
    });
    const getSettings = () => settings;
    const hub = new ChatMissionHub({ getSettings, developer: () => null });
    const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request) {
        const router = (request.system ?? '').includes('chef d’orchestre');
        if (router) {
          yield { type: 'text' as const, delta: 'code' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
          return;
        }
        yield {
          type: 'tool_call' as const,
          call: {
            id: 'pm1',
            name: 'proposer_mission',
            arguments: {
              type: 'nouveau-projet',
              objectif: 'Créer un script Python qui affiche bonjour',
            },
          },
        };
        yield { type: 'done' as const, finishReason: 'tool_calls' as const };
      },
    }));
    const baseTools = createToolManager({
      getSettings,
      searchRegistry: core.createDefaultSearchRegistry(),
      marketDataRegistry: core.createDefaultMarketDataRegistry(),
      spotify: new SpotifyBridge(getSettings),
      siteBlock: new SiteBlockBridge(getSettings),
      personalization: new PersonalizationStore(),
      knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
    });
    expect(createProposerMissionTool(hub).name).toBe('proposer_mission');
    const events: ChatEvent[] = [];
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, event: ChatEvent) => events.push(event),
    } as unknown as Electron.WebContents;
    const session = new ChatSession({
      registry,
      tools: baseTools,
      store: new core.InMemoryConversationStore(),
      auditLog: new core.InMemoryAuditLogStore(),
      getSettings,
      voice: { hasApiKey: () => false } as never,
      personalization: { get: async () => core.emptyPersonalization() } as never,
      knowledge: { indexConversation: async () => 0 } as never,
      localLearning: { recordTurn: async () => undefined } as never,
      getChatMissionHub: () => hub,
    });
    await session.send(sender, {
      conversationId: null,
      text: 'Crée-moi un script Python bonjour',
    });
    const proposal = events.find((event) => event.type === 'mission_proposal');
    expect(proposal?.type).toBe('mission_proposal');
    expect(proposal?.message.chatMission?.kind).toBe('proposal');
    const done = events.find((event) => event.type === 'done');
    expect(done?.messages.some((message) => message.chatMission?.kind === 'proposal')).toBe(true);
  });
});
