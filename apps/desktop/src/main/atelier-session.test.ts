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

const PIECE: Extract<AtelierEtat, { etape: 'piece' }> = {
  etape: 'piece',
  gabarit: 'boite',
  nom: 'boîte',
  dossier: 'boite-2026-11-23-1',
  versionChoisie: 1,
  plateau: { x: 250, y: 250 },
  versions: [{ numero: 1, valeurs: {}, fiche: 'Boîte de 80 × 50 × 30 mm.', mesures: [], taille: [80, 50, 30], stl: 'v1.stl' }],
};

function setup(wired = true, options: { imagerActif?: boolean; atelierReel?: boolean } = {}) {
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
  const imagerAppels: string[] = [];
  // Imager activé : le mode direct prendrait « dessine-moi … » avant tout modèle.
  const images = {
    isEnabled: () => true,
    loadRules: async () => ({ rules: null }),
    generateDirect: async (request: { prompt: string }) => {
      imagerAppels.push(request.prompt);
      throw new Error('Imager ne doit pas être appelé');
    },
  };
  const atelier = async (input: { text: string; messages: readonly unknown[]; progress: (m: string) => void }) => {
    vus.push(input.messages.length);
    // `atelierReel` : la vraie décision de l'atelier (règles du cœur), sans OpenSCAD.
    if (options.atelierReel) {
      const messages = input.messages as Parameters<typeof core.dernierAtelier>[0];
      const d = core.deciderAtelier(input.text, core.dernierAtelier(messages), { mesures: {} });
      if (d.kind === 'rien') return null;
      if (d.kind === 'dire') return { texte: d.texte, ...(d.etat ? { etat: d.etat } : {}) };
      if (d.kind !== 'fabriquer') return { texte: d.kind };
      const etat: AtelierEtat = { ...PIECE, versions: [{ ...PIECE.versions[0]!, valeurs: d.valeurs }] };
      return { texte: `Pièce rendue (${d.changement ?? 'nouvelle'}).`, etat };
    }
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
    ...(options.imagerActif ? { images: images as never } : {}),
  });
  let conversationId: string | null = null;
  const say = async (text: string) => {
    events.length = 0;
    await session.send(sender, { conversationId, text });
    const saved = await store.list();
    conversationId = saved[0]!.id;
    return (await store.get(conversationId))!.messages;
  };
  return { modelCalls, say, events, vus, imagerAppels };
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

  it("phrases de l'utilisateur (Jarvis Test, 23 et 24 novembre) : l'atelier, sans cerveau ni équipe", async () => {
    const { modelCalls, say, events } = setup(true, { atelierReel: true, imagerActif: true });
    for (const phrase of [
      'Fais-moi une boîte de 80 par 50 par 30',
      "Fais-moi une boîte de 120 par 80 par 40 avec des plots pour un Raspberry Pi 5, ports vers l'arrière",
    ]) {
      const messages = await say(phrase);
      expect(messages.at(-1)?.atelier?.etape).toBe('piece');
      expect(events.some((e) => e.type === 'route')).toBe(false);
    }
    expect(modelCalls).toEqual([]);
  });

  it('« Dessine-moi un boîtier… » va à l’atelier même avec Imager activé ; « dessine-moi un chat » reste à Imager', async () => {
    const { modelCalls, say, imagerAppels } = setup(true, { atelierReel: true, imagerActif: true });
    const messages = await say('Dessine-moi un boîtier pour un écran de 7 pouces');
    // L'écran de 7 pouces est l'écran tactile du Pi : le boîtier à écran (depuis l'examen du hub, 25 novembre).
    expect(messages.at(-1)?.atelier?.etape).toBe('piece');
    expect(imagerAppels).toEqual([]);
    expect(modelCalls).toEqual([]);
    await say('Dessine-moi un chat');
    expect(imagerAppels).toHaveLength(1);
  });

  it('pièce à l’écran : câble, écran, Raspberry Pi vont à l’atelier ; le reste suit son chemin', async () => {
    const { modelCalls, say } = setup(true, { atelierReel: true });
    await say('Fais-moi une boîte de 120 par 80 par 40');
    for (const phrase of [
      'Fais passer le câble par le côté gauche',
      "Fais une fenêtre pour l'écran sur le dessus",
      "Mets des plots pour un Raspberry Pi 5 dans le fond, ports vers l'arrière",
      'Ajoute des aérations sur les côtés',
    ]) {
      const messages = await say(phrase);
      expect(messages.at(-1)?.atelier?.etape).toBe('piece');
    }
    expect(modelCalls).toEqual([]);
    const autre = await say('Ferme la fenêtre');
    expect(autre.at(-1)?.content).toBe('Réponse du modèle.');
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
