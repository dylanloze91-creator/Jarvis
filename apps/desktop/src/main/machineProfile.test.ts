import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Profil complet : la liste d’outils et le prompt envoyés au modèle restent
 * ceux d’une installation 0.4.25 (réglages sans champ `machine`).
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-machine-profile-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '0.4.26', isPackaged: false },
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

const GIB = 1024 ** 3;

type Settings = ReturnType<typeof core.parseSettings>;

function toolsFor(settings: Settings) {
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

function catalog(settings: Settings) {
  const manager = toolsFor(settings);
  return {
    schemas: manager.schemas(),
    risks: manager.list().map((tool) => ({
      name: tool.name,
      risk: tool.risk,
      category: tool.category ?? null,
      forceConfirm: tool.forceConfirm,
      internal: tool.internal === true,
    })),
  };
}

interface CapturedRequest {
  system?: string;
  messages: Array<{ role: string; content: string }>;
  tools: string[];
  temperature?: number;
}

function capturingRegistry(requests: CapturedRequest[]) {
  return new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request) {
      requests.push({
        system: request.system,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        tools: (request.tools ?? []).map((tool) => tool.name),
        temperature: request.temperature,
      });
      yield { type: 'text' as const, delta: 'Très bien.' };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
}

const TURNS = ['Bonjour Jarvis, comment vas-tu ?', 'Quelle heure est-il ?', 'Mets Daft Punk sur Spotify'];

async function promptsFor(settings: Settings) {
  const captured = [];
  for (const text of TURNS) {
    const requests: CapturedRequest[] = [];
    const events: ChatEvent[] = [];
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, event: ChatEvent) => events.push(event),
    } as unknown as Electron.WebContents;
    const session = new ChatSession({
      registry: capturingRegistry(requests),
      tools: toolsFor(settings),
      store: new core.InMemoryConversationStore(),
      auditLog: new core.InMemoryAuditLogStore(),
      getSettings: () => settings,
      voice: { hasApiKey: () => false } as never,
      personalization: { get: async () => core.emptyPersonalization() } as never,
      knowledge: { indexConversation: async () => 0 } as never,
    });
    await session.send(sender, { conversationId: null, text });
    captured.push({ text, requests });
  }
  return captured;
}

const legacy = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:3b' });
const full = core.applyMachineProfile(
  core.defaultSettings,
  core.selectMachineProfile({
    failed: false,
    totalRamBytes: 64 * GIB,
    cpuModel: 'Intel Core i7-9700KF',
    logicalCores: 8,
    gpus: [{ name: 'NVIDIA GeForce RTX 2060', totalMiB: 6144 }],
    gpuProbe: 'ok',
    freeDiskBytes: 40 * GIB,
    ollamaPresent: true,
  }),
);

describe('profil complet identique à 0.4.25', () => {
  it('liste d’outils et catalogue du modèle', () => {
    expect(catalog(full)).toEqual(catalog(legacy));
    expect(full.machine?.profile).toBe('full');
    expect(legacy.machine).toBeUndefined();
  });

  it('prompts des tours Bonjour, heure et Spotify', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 10, 0));
    try {
      expect(await promptsFor(full)).toEqual(await promptsFor(legacy));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('profil modeste', () => {
  it('ne propose au modèle que l’heure, les notes, ouvrir une application et la recherche web', () => {
    const modest = core.applyMachineProfile(
      core.defaultSettings,
      core.selectMachineProfile({
        failed: false,
        totalRamBytes: 8 * GIB,
        cpuModel: 'Intel Core i5',
        logicalCores: 4,
        gpus: [{ name: 'NVIDIA GeForce GTX 1050 Ti', totalMiB: 4096 }],
        gpuProbe: 'ok',
        freeDiskBytes: 20 * GIB,
        ollamaPresent: true,
      }),
    );
    const names = toolsFor(modest).schemas().map((tool) => tool.name);
    expect(names).toEqual([
      'get_current_time',
      'search_jarvis_memory',
      'remember_jarvis',
      'open_application',
      'web_search',
    ]);
    expect(toolsFor(modest).list().some((tool) => tool.name === 'web_search_current' && tool.internal)).toBe(true);
    expect(names).not.toContain('youtube_transcript');
    expect(names).not.toContain('remember_video');
  });
});
