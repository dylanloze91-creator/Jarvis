/**
 * Rejeu d'une discussion d'essai dans la vraie session de chat de Jarvis Test (vrai Ollama, vrai
 * atelier, vraie recherche web), sur une copie des réglages : le Jarvis Test installé et ses
 * données ne sont jamais touchés.
 *
 *   JARVIS_REJEU=C:\dev\jarvis-data\essais\<fichier>.json npm run banc:rejeu --workspace @jarvis/desktop
 *
 * Le fichier (hors du dépôt) : `{ "phrases": ["…", "…"] }`, dites l'une après l'autre dans la même
 * discussion. Les phrases ne sont jamais écrites dans le dépôt ni dans un jeu d'entraînement.
 *
 * Rien ne sort du PC pour de vrai : `generer_image` est remplacé par une réponse « non générée »
 * (Forge n'est pas lancé), les cartes de confirmation sont refusées, l'atelier écrit dans un dossier
 * temporaire (seules les mesures prises par l'utilisateur y sont copiées).
 *
 * Variables :
 *   JARVIS_REJEU_PASSAGES=1      nombre de passages de la discussion entière
 *   JARVIS_REJEU_COTES=1         copier aussi les cotes déjà trouvées sur Internet (sinon : recherche refaite)
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { ToolCallOutcome } from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-rejeu-'));
const racineAtelier = mkdtempSync(join(tmpdir(), 'jarvis-rejeu-atelier-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => 'banc', isPackaged: false },
  shell: { openExternal: async () => undefined, openPath: async () => '' },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const SOURCE = join(process.env.APPDATA ?? '', 'Jarvis Test');
for (const name of ['personalization.json']) {
  if (existsSync(join(SOURCE, name))) copyFileSync(join(SOURCE, name), join(userData, name));
}
const ATELIER_REEL = process.platform === 'win32' ? 'C:\\dev\\jarvis-data\\atelier' : '';
const copies = ['composants-mesures.json', ...(process.env.JARVIS_REJEU_COTES === '1' ? ['composants-cotes.json'] : [])];
for (const name of copies) {
  if (ATELIER_REEL && existsSync(join(ATELIER_REEL, name))) copyFileSync(join(ATELIER_REEL, name), join(racineAtelier, name));
}

process.env.JARVIS_EDITION = 'test';
const core = await import('@jarvis/core');
const { createToolManager } = await import('../tools/index.js');
const { ChatSession } = await import('../session.js');
const { SpotifyBridge } = await import('../media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('../siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('../personalization.js');
const { KnowledgeStore } = await import('../knowledge.js');
const { stubLocalLearning } = await import('../test/localLearningStub.js');
const { creerAtelierPC, ORCA_RACINE } = await import('../atelier/atelierPC.js');
const { edition } = await import('../edition.js');

afterAll(() => {
  rmSync(userData, { recursive: true, force: true });
  rmSync(racineAtelier, { recursive: true, force: true });
});

const TURN_DEADLINE_MS = 300_000;

function reglages(): ReturnType<typeof core.parseSettings> {
  const raw = JSON.parse(readFileSync(join(SOURCE, 'settings.json'), 'utf8')) as Record<string, unknown>;
  delete raw.developer;
  raw.debugLogging = false;
  return core.parseSettings(raw);
}

it(
  'rejeu d’une discussion d’essai',
  async () => {
    const fichier = process.env.JARVIS_REJEU;
    if (!fichier) throw new Error('JARVIS_REJEU : chemin du fichier de phrases (hors du dépôt).');
    const phrases = (JSON.parse(readFileSync(fichier, 'utf8')) as { phrases: string[] }).phrases;
    const passages = Math.max(1, Number(process.env.JARVIS_REJEU_PASSAGES ?? 1) || 1);
    expect(edition().atelier).toBe(true);
    const settings = reglages();
    const getSettings = () => settings;
    const searchRegistry = core.createWebSearchRegistry();
    const knowledge = new KnowledgeStore({ getUserDataPath: () => userData });
    const tools = createToolManager({
      getSettings,
      searchRegistry,
      marketDataRegistry: core.createDefaultMarketDataRegistry(),
      spotify: new SpotifyBridge(getSettings),
      siteBlock: new SiteBlockBridge(getSettings),
      personalization: new PersonalizationStore(),
      knowledge,
    });
    const realExecute = tools.execute.bind(tools);
    tools.execute = async (call, context) => {
      if (call.name !== 'generer_image') return realExecute(call, context);
      return {
        callId: call.id,
        name: call.name,
        status: 'ok',
        content: 'Image non générée (rejeu : Forge n’est pas lancé).',
        arguments: call.arguments,
        decision: 'allowed',
        durationMs: 1,
        outcome: 'success',
      } as unknown as ToolCallOutcome;
    };
    const session = new ChatSession({
      registry: core.createDefaultRegistry(),
      tools,
      store: new core.InMemoryConversationStore(),
      auditLog: new core.InMemoryAuditLogStore(),
      getSettings,
      voice: { hasApiKey: () => false } as never,
      personalization: new PersonalizationStore(),
      knowledge,
      localLearning: stubLocalLearning(),
      atelier: creerAtelierPC(getSettings, racineAtelier, ORCA_RACINE, searchRegistry),
    });

    for (let passage = 1; passage <= passages; passage += 1) {
      let conversationId: string | null = null;
      for (const [index, text] of phrases.entries()) {
        const events: ChatEvent[] = [];
        const sender = {
          isDestroyed: () => false,
          send: (_channel: string, event: ChatEvent) => {
            events.push(event);
            if (event.type === 'confirm') session.respondConfirmation(event.requestId, false);
          },
        } as unknown as Electron.WebContents;
        const timer = setTimeout(() => session.cancel(), TURN_DEADLINE_MS);
        const started = Date.now();
        try {
          await session.send(sender, { conversationId, text });
        } finally {
          clearTimeout(timer);
        }
        const ms = Date.now() - started;
        const done = events.find((event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done');
        const route = events.find((event): event is Extract<ChatEvent, { type: 'route' }> => event.type === 'route');
        const outils = events
          .filter((event): event is Extract<ChatEvent, { type: 'tool_start' }> => event.type === 'tool_start')
          .map((event) => event.toolName);
        const erreur = events.find((event): event is Extract<ChatEvent, { type: 'error' }> => event.type === 'error');
        const reponse = events
          .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
          .map((event) => event.text)
          .join('')
          .replace(/\s+/g, ' ');
        console.log(
          `[rejeu] ${passage}/${passages} phrase ${index + 1} : ${route?.team ?? '—'}/${route?.how ?? '—'} · ` +
            `${outils.join(' ') || 'aucun outil'} · ${(ms / 1000).toFixed(1)} s${erreur ? ` · erreur ${JSON.stringify(erreur)}` : ''}`,
        );
        console.log(`[réponse ${index + 1}] ${reponse.slice(0, 900)}`);
        conversationId = done?.conversationId ?? conversationId;
      }
    }
  },
  2 * 60 * 60_000,
);
