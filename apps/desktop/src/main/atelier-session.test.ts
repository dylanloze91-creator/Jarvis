import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AtelierEtat } from '@jarvis/core';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Atelier 3D dans la vraie session de chat (Jarvis Test) :
 * - une phrase d'atelier répond sans aucun modèle, l'état est posé sur la réponse enregistrée,
 *   et une pièce part à la fenêtre (événement `atelier`) ;
 * - l'atelier reçoit la discussion d'avant (c'est là que vit son état) ;
 * - sans la fonction (Jarvis Live) ou pour une autre phrase, le tour suit le chemin d'avant.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-atelier-session-'));

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

afterAll(() => rmSync(userData, { recursive: true, force: true }));

const PIECE: AtelierEtat = {
  etape: 'piece',
  gabarit: 'boite',
  nom: 'boîte',
  dossier: 'boite-2026-11-23-1',
  versionChoisie: 1,
  plateau: { x: 250, y: 250 },
  versions: [{ numero: 1, valeurs: {}, fiche: 'Boîte de 80 × 50 × 30 mm.', mesures: [], taille: [80, 50, 30], stl: 'v1.stl' }],
};

function setup(wired = true) {
  const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:7b' });
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
  const vus: number[] = [];
  const atelier = async (input: { text: string; messages: readonly unknown[]; progress: (m: string) => void }) => {
    vus.push(input.messages.length);
    if (!/boîte/.test(input.text)) return null;
    input.progress('OpenSCAD dessine la pièce…');
    return { texte: 'Boîte de 80 × 50 × 30 mm.', etat: PIECE };
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
    ...(wired ? { atelier } : {}),
  });
  let conversationId: string | null = null;
  const say = async (text: string) => {
    events.length = 0;
    await session.send(sender, { conversationId, text });
    const saved = await store.list();
    conversationId = saved[0]!.id;
    return (await store.get(conversationId))!.messages;
  };
  return { modelCalls, say, events, vus };
}

describe('atelier 3D dans la session', () => {
  it('une pièce : sans modèle, état sur la réponse enregistrée, écran 3D envoyé à la fenêtre', async () => {
    const { modelCalls, say, events, vus } = setup();
    const messages = await say('Fais-moi une boîte de 80 par 50 par 30');
    expect(modelCalls).toEqual([]);
    const reponse = messages.at(-1)!;
    expect(reponse.role).toBe('assistant');
    expect(reponse.content).toBe('Boîte de 80 × 50 × 30 mm.');
    expect(reponse.atelier).toEqual(PIECE);
    expect(events).toContainEqual({ type: 'atelier', messageId: reponse.id, etat: PIECE });
    expect(events.find((e) => e.type === 'tool_start')).toMatchObject({ toolName: 'atelier', summary: 'OpenSCAD dessine la pièce…' });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ toolName: 'atelier', status: 'ok' });
    expect(vus).toEqual([0]);

    // Phrase suivante : l'atelier reçoit la discussion d'avant ; une autre phrase va au modèle.
    const suite = await say('Merci, et quel temps fait-il ?');
    expect(vus).toEqual([0, 2]);
    expect(suite.at(-1)?.content).toBe('Réponse du modèle.');
    expect(suite.at(-1)?.atelier).toBeUndefined();
    expect(modelCalls).toHaveLength(1);
  });

  it('Jarvis Live (fonction absente) : la phrase va au modèle comme avant', async () => {
    const { modelCalls, say, events } = setup(false);
    const messages = await say('Fais-moi une boîte de 80 par 50 par 30');
    expect(messages.at(-1)?.content).toBe('Réponse du modèle.');
    expect(modelCalls).toHaveLength(1);
    expect(events.some((e) => e.type === 'atelier')).toBe(false);
  });
});
