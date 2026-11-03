import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Caractère de Jarvis dans une vraie session : la fiche de personnage vit dans
 * les consignes des équipes du chef d'orchestre (entière pour Conversation et
 * Code, courte pour les équipes à outils), avec le prénom de la personnalisation.
 * Le cerveau routeur et le chat sans orchestre ne la reçoivent jamais
 * (`chat-unchanged.test.ts` garde ce chat à l'identique).
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

const ORCHESTRA = { enabled: true, brain: 'qwen2.5:7b' };

async function turn(
  text: string,
  extra: Record<string, unknown>,
  options: { source?: 'text' | 'voice'; brainReply?: string } = {},
) {
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
      yield { type: 'text' as const, delta: router ? (options.brainReply ?? 'conversation') : 'Très bien.' };
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
  await session.send(sender, { conversationId: null, text, source: options.source ?? 'text' });
  const brain = systems.find((system) => system.includes('chef d’orchestre')) ?? '';
  const team = systems.find((system) => !system.includes('chef d’orchestre')) ?? '';
  return { systems, events, brain, team };
}

describe('caractère de Jarvis dans le chat', () => {
  it('équipe Conversation : la fiche entière suit la consigne de l’équipe, avec le prénom ; le cerveau ne l’a pas', async () => {
    const { brain, team } = await turn('Tu penses quoi de mon plan ?', {
      orchestra: ORCHESTRA,
      persona: { enabled: true, style: 'majordome' },
    });
    expect(brain).toContain('chef d’orchestre');
    expect(brain).not.toContain('CARACTÈRE DE JARVIS');
    const teamLine = team.indexOf('ÉQUIPE CONVERSATION');
    const sheet = team.indexOf('CARACTÈRE DE JARVIS.');
    expect(teamLine).toBeGreaterThan(0);
    expect(sheet).toBeGreaterThan(teamLine);
    expect(team).toContain('Tu vouvoies');
    expect(team).toContain('s’appelle Dylan');
    expect(team).toContain('un programme qui tourne sur ce PC');
  });

  it('équipe à outils (PC) : version courte, et à l’oral la réponse reste brève', async () => {
    const { team } = await turn(
      'Ouvre le Bloc-notes',
      { orchestra: ORCHESTRA, persona: { enabled: true } },
      { source: 'voice', brainReply: 'pc' },
    );
    expect(team).toContain('ÉQUIPE PC');
    expect(team).toContain('CARACTÈRE DE JARVIS (en bref).');
    expect(team).not.toContain('CARACTÈRE DE JARVIS.');
    expect(team).toContain('lue à voix haute');
  });

  it('humour coupé : la fiche le dit', async () => {
    const { team } = await turn('Raconte-moi ta journée', {
      orchestra: ORCHESTRA,
      persona: { enabled: true, humour: false },
    });
    expect(team).toContain('Pas de plaisanterie');
  });

  it('sans chef d’orchestre : le chat garde son prompt, même avec le caractère activé', async () => {
    const { systems } = await turn('Bonjour', { persona: { enabled: true } });
    expect(systems).toHaveLength(1);
    expect(systems[0]).not.toContain('CARACTÈRE');
  });

  it('coupé ou absent : aucune fiche dans l’équipe', async () => {
    const off = await turn('Bonjour', { orchestra: ORCHESTRA, persona: { enabled: false } });
    expect(off.team).not.toContain('CARACTÈRE');
    const absent = await turn('Bonjour', { orchestra: ORCHESTRA });
    expect(absent.team).toContain('ÉQUIPE CONVERSATION');
    expect(absent.team).not.toContain('CARACTÈRE');
  });
});
