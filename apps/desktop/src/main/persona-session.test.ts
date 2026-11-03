import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Caractère de Jarvis dans une vraie session : la fiche de personnage suit la
 * consigne de base, chat classique comme chef d'orchestre, avec le prénom de la
 * personnalisation. Réglage absent : `chat-unchanged.test.ts` garde le chat à
 * l'identique.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-persona-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.66', isPackaged: false },
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

async function turn(text: string, extra: Record<string, unknown>, source: 'text' | 'voice' = 'text') {
  const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:3b', ...extra });
  const getSettings = () => settings;
  const systems: string[] = [];
  const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request) {
      systems.push(request.system ?? '');
      const router = (request.system ?? '').includes('chef d’orchestre');
      yield { type: 'text' as const, delta: router ? 'conversation' : 'Très bien.' };
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
    personalization: {
      get: async () => ({ ...core.emptyPersonalization(), user: { prenom: 'Dylan' } }),
    } as never,
    knowledge: { indexConversation: async () => 0 } as never,
    localLearning: { recordTurn: async () => undefined } as never,
  });
  await session.send(sender, { conversationId: null, text, source });
  return { systems, events };
}

describe('caractère de Jarvis dans le chat', () => {
  it('activé : la fiche suit la consigne de base, avec le prénom, avant la mémoire de personnalisation', async () => {
    const { systems } = await turn('Tu penses quoi de mon plan ?', { persona: { enabled: true, style: 'majordome' } });
    expect(systems).toHaveLength(1);
    const system = systems[0] ?? '';
    const base = system.indexOf(core.DEFAULT_SYSTEM_PROMPT.slice(0, 40));
    const sheet = system.indexOf('CARACTÈRE DE JARVIS.');
    const memory = system.indexOf('MÉMOIRE DE PERSONNALISATION');
    expect(base).toBe(0);
    expect(sheet).toBeGreaterThan(base);
    expect(memory).toBeGreaterThan(sheet);
    expect(system).toContain('Tu vouvoies');
    expect(system).toContain('s’appelle Dylan');
  });

  it('à l’oral : la fiche demande une réponse parlée', async () => {
    const { systems } = await turn('Raconte-moi ta journée', { persona: { enabled: true } }, 'voice');
    expect(systems[0]).toContain('lue à voix haute');
  });

  it('chef d’orchestre : l’équipe reçoit la fiche, le cerveau non', async () => {
    const { systems } = await turn('Raconte-moi ta journée', {
      persona: { enabled: true, humour: false },
      orchestra: { enabled: true, brain: 'qwen2.5:7b' },
    });
    const brain = systems.find((system) => system.includes('chef d’orchestre')) ?? '';
    const team = systems.find((system) => !system.includes('chef d’orchestre')) ?? '';
    expect(brain).not.toContain('CARACTÈRE DE JARVIS');
    expect(team).toContain('CARACTÈRE DE JARVIS');
    expect(team).toContain('Pas de plaisanterie');
  });

  it('coupé ou absent : aucune fiche', async () => {
    const off = await turn('Bonjour', { persona: { enabled: false } });
    expect(off.systems[0]).not.toContain('CARACTÈRE');
    const absent = await turn('Bonjour', {});
    expect(absent.systems[0]).not.toContain('CARACTÈRE');
  });
});
