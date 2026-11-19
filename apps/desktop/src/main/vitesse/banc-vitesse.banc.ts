/**
 * Banc de vitesse (mission « Jarvis plus rapide, sans nouveau modèle »).
 *
 *   npm run banc:vitesse --workspace @jarvis/desktop -- [étiquette]
 *   (ou la variable JARVIS_BANC_LABEL ; défaut : « passage »)
 *
 * Il passe une vingtaine de demandes types dans la vraie session de chat de Jarvis Test : mêmes
 * réglages (lus, jamais écrits, dans le dossier de Jarvis Test), même chef d'orchestre, même
 * catalogue d'outils, vrai Ollama. Seules la fenêtre et la voix manquent.
 *
 * Ce qu'il ne touche pas : les conversations, la mémoire, le carnet et l'apprentissage de
 * l'utilisateur. Tout se passe en mémoire et dans un dossier temporaire. Les demandes types sont
 * écrites par Claude Code : elles n'entrent dans aucun jeu d'entraînement.
 *
 * Résultat : `C:\dev\jarvis-data\vitesse\banc\<étiquette>.json` (durées, comptes, noms d'équipe,
 * de modèle et d'outil ; aucune phrase, aucune réponse).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { BenchRun, BenchTurn, TurnLogEntry } from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-banc-vitesse-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => 'banc', isPackaged: false },
  shell: { openExternal: async () => undefined, openPath: async () => '' },
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
const { stubLocalLearning } = await import('../test/localLearningStub.js');
const { benchStartup } = await import('./demarrage.js');
const { edition } = await import('../edition.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

/** Plafond d'une demande. Au-delà, elle est arrêtée et notée « delai ». */
const TURN_DEADLINE_MS = 240_000;

interface Demande {
  id: string;
  /** Demandes d'une même discussion : elles partagent l'historique. */
  discussion: string;
  text: string;
}

/**
 * Demandes types, toutes en lecture : rien ne s'ouvre, ne se ferme, ne joue ni ne s'efface.
 * L'ordre mélange les équipes exprès, comme un vrai usage (va-et-vient entre modèles).
 */
const DEMANDES: Demande[] = [
  { id: 'a1', discussion: 'A', text: 'Bonjour Jarvis, comment vas-tu ?' },
  { id: 'b1', discussion: 'B', text: 'Quelle heure est-il ?' },
  { id: 'a2', discussion: 'A', text: 'Explique-moi en deux phrases ce qu’est un trou noir.' },
  { id: 'c1', discussion: 'C', text: 'Donne-moi les informations sur mon PC : processeur et mémoire.' },
  { id: 'd1', discussion: 'D', text: 'Quelle est la météo à Paris aujourd’hui ?' },
  { id: 'a3', discussion: 'A', text: 'Et pourquoi la lumière ne peut-elle pas en sortir ?' },
  { id: 'b2', discussion: 'B', text: 'Combien font 12 fois 37 ?' },
  { id: 'c2', discussion: 'C', text: 'Quels processus utilisent le plus de mémoire sur mon PC ?' },
  { id: 'd2', discussion: 'D', text: 'Quelle est la météo à Paris aujourd’hui ?' },
  { id: 'e1', discussion: 'E', text: 'Le cours de l’action Airbus' },
  { id: 'h1', discussion: 'H', text: 'Quel morceau est en train de jouer sur Spotify ?' },
  { id: 'a4', discussion: 'A', text: 'Donne-moi trois idées de repas rapides pour ce soir.' },
  { id: 'g1', discussion: 'G', text: 'Cherche dans ta mémoire ce que tu sais sur mes projets.' },
  { id: 'c3', discussion: 'C', text: 'Quelle fenêtre est active sur mon PC ?' },
  { id: 'd3', discussion: 'F', text: 'Cherche sur internet la hauteur de la tour Eiffel.' },
  { id: 'd4', discussion: 'F', text: 'Cherche sur internet la hauteur de la tour Eiffel.' },
  { id: 'e2', discussion: 'E', text: 'Le cours de l’action Airbus' },
  { id: 'f1', discussion: 'I', text: 'Cherche les fichiers nommés CLAUDE.md dans le dossier C:\\dev\\Jarvis.' },
  { id: 'f2', discussion: 'I', text: 'Cherche aussi les fichiers nommés FEUILLE-DE-ROUTE.md dans le dossier C:\\dev\\Jarvis.' },
  { id: 'b3', discussion: 'B', text: 'On est quel jour ?' },
  { id: 'i1', discussion: 'J', text: 'En une ligne de Python, comment inverser une chaîne de caractères ?' },
  { id: 'j1', discussion: 'A', text: 'Merci. Résume en une phrase ce qu’on vient de se dire.' },
  // Deuxième demande aux équipes qui tournent sur le processeur : le début du prompt est-il relu ?
  { id: 'i2', discussion: 'J2', text: 'En une ligne de Python, comment mettre une chaîne de caractères en majuscules ?' },
  { id: 'g2', discussion: 'G2', text: 'Cherche dans ta mémoire ce que tu sais sur ma voiture.' },
  // Une discussion qui s'allonge, avec des résultats d'outil dans l'historique.
  { id: 'm1', discussion: 'M', text: 'Cherche sur internet la population de Lyon.' },
  { id: 'm2', discussion: 'M', text: 'Cherche sur internet la population de Marseille.' },
  { id: 'm3', discussion: 'M', text: 'Cherche sur internet la population de Toulouse.' },
  { id: 'm4', discussion: 'M', text: 'Cherche sur internet la population de Nice.' },
  // Une question d'heure que la règle de l'horloge ne reconnaît pas : le modèle doit lire la ligne d'heure.
  { id: 'k1', discussion: 'K', text: 'Dis-moi, il est déjà tard là, non ?' },
];

function reglagesDeJarvisTest(): ReturnType<typeof core.parseSettings> {
  const file = join(process.env.APPDATA ?? '', 'Jarvis Test', 'settings.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  // Hors banc : les images (Forge), les missions depuis la discussion et le journal de débogage.
  delete raw.images;
  delete raw.developer;
  raw.debugLogging = false;
  // JARVIS_BANC_EQUIPES=memoire=qwen2.5:7b@carte,code=qwen2.5:7b@carte : essayer une autre
  // répartition des modèles pour ce passage seulement (les réglages de l'utilisateur ne changent pas).
  const orchestra = raw.orchestra as { teams?: Record<string, { model: string; place: string }> } | undefined;
  for (const item of (process.env.JARVIS_BANC_EQUIPES ?? '').split(',')) {
    const match = /^([a-z]+)=(.+)@(carte|processeur)$/.exec(item.trim());
    if (!match || !orchestra) continue;
    orchestra.teams = { ...(orchestra.teams ?? {}), [match[1]!]: { model: match[2]!, place: match[3]! } };
  }
  return core.parseSettings(raw);
}

async function ollama<T>(baseUrl: string, path: string, body?: unknown): Promise<T | null> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

interface Loaded {
  models?: { name: string; size?: number; size_vram?: number }[];
}

/** Départ à froid : tous les modèles sont déchargés, comme au premier lancement de la journée. */
async function dechargerTout(baseUrl: string): Promise<void> {
  const loaded = await ollama<Loaded>(baseUrl, '/api/ps');
  for (const model of loaded?.models ?? []) {
    await ollama(baseUrl, '/api/generate', { model: model.name, keep_alive: 0 });
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const now = await ollama<Loaded>(baseUrl, '/api/ps');
    if (!now?.models?.length) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function commit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

it(
  'banc de vitesse',
  async () => {
    process.env.JARVIS_EDITION = 'test';
    // JARVIS_BANC_SANS=chauds,heure,memoire : couper un outil de vitesse pour ce passage seulement,
    // afin de mesurer chaque outil avec et sans lui (la table d'édition n'est changée que dans le banc).
    const sans = (process.env.JARVIS_BANC_SANS ?? '').split(',').map((name) => name.trim());
    const table = core.TEST_EDITION as { keepModelsWarm?: boolean; clockAfterHistory?: boolean; keepToolResults?: boolean };
    if (sans.includes('chauds')) table.keepModelsWarm = false;
    if (sans.includes('heure')) table.clockAfterHistory = false;
    if (sans.includes('memoire')) table.keepToolResults = false;
    const label = (process.env.JARVIS_BANC_LABEL ?? 'passage').replace(/[^\w.-]+/g, '-');
    const settings = reglagesDeJarvisTest();
    const baseUrl = (settings.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const getSettings = () => settings;
    const knowledge = new KnowledgeStore({ getUserDataPath: () => userData });
    const tools = createToolManager({
      getSettings,
      searchRegistry: core.createWebSearchRegistry(),
      marketDataRegistry: core.createDefaultMarketDataRegistry(),
      spotify: new SpotifyBridge(getSettings),
      siteBlock: new SiteBlockBridge(getSettings),
      personalization: new PersonalizationStore(),
      knowledge,
    });
    // Comme l'appli : la mémoire courte des outils, quand l'édition la prévoit.
    if (edition().keepToolResults) tools.useResultMemory(new core.ToolResultMemory());
    const registry = core.createDefaultRegistry();
    const store = new core.InMemoryConversationStore();
    const session = new ChatSession({
      registry,
      tools,
      store,
      auditLog: new core.InMemoryAuditLogStore(),
      getSettings,
      voice: { hasApiKey: () => false } as never,
      personalization: new PersonalizationStore(),
      knowledge,
      localLearning: stubLocalLearning(),
    });

    if (process.env.JARVIS_BANC_FROID !== '0') await dechargerTout(baseUrl);
    // Ce que l'appli fait à son démarrage (préchauffage) : le banc le fait aussi, et le mesure.
    const warmupMs = await benchStartup({ settings });

    // JARVIS_BANC_SEULEMENT=g1,g2 : ne passer que ces demandes (pour compléter un passage).
    const only = (process.env.JARVIS_BANC_SEULEMENT ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    const demandes = only.length ? DEMANDES.filter((demande) => only.includes(demande.id)) : DEMANDES;
    const conversations = new Map<string, string>();
    const turns: BenchTurn[] = [];
    for (const demande of demandes) {
      const events: ChatEvent[] = [];
      const sender = {
        isDestroyed: () => false,
        send: (_channel: string, event: ChatEvent) => {
          events.push(event);
          // Aucune action n'est acceptée pendant le banc.
          if (event.type === 'confirm') session.respondConfirmation(event.requestId, false);
        },
      } as unknown as Electron.WebContents;
      const timer = setTimeout(() => session.cancel(), TURN_DEADLINE_MS);
      let timedOut = false;
      const started = Date.now();
      try {
        await session.send(sender, { conversationId: conversations.get(demande.discussion) ?? null, text: demande.text });
      } finally {
        clearTimeout(timer);
        timedOut = Date.now() - started >= TURN_DEADLINE_MS;
      }
      const done = events.find((event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done');
      if (done?.conversationId) conversations.set(demande.discussion, done.conversationId);
      const conversation = done?.conversationId ? await store.get(done.conversationId) : null;
      const entry: TurnLogEntry | undefined = conversation?.turnLog?.at(-1);
      const failed = events.some((event) => event.type === 'error');
      const statut: BenchTurn['statut'] = timedOut ? 'delai' : failed || !entry ? 'erreur' : 'ok';
      const turn: BenchTurn = entry
        ? { ...entry, demande: demande.id, statut, userMessageId: demande.id, assistantMessageIds: [] }
        : {
            demande: demande.id,
            statut,
            userMessageId: demande.id,
            assistantMessageIds: [],
            team: null,
            how: null,
            provider: 'aucun',
            model: null,
            place: null,
            source: 'texte',
            tools: [],
            durationMs: Date.now() - started,
            at: started,
          };
      turns.push(turn);
      // Contrôle de la qualité : les réponses aux demandes types (écrites pour le banc) s'affichent
      // à la demande. Elles ne sont jamais enregistrées.
      if (process.env.JARVIS_BANC_REPONSES === '1') {
        const reply = events
          .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
          .map((event) => event.text)
          .join('');
        console.log(`[réponse ${demande.id}] ${reply.replace(/\s+/g, ' ').slice(0, 400)}`);
      }
      const steps = turn.etapes;
      console.log(
        `[banc] ${demande.id} ${turn.team ?? '—'}/${steps?.tri?.chemin ?? turn.how ?? '—'} ${turn.model ?? 'sans modèle'} : ` +
          `${turn.durationMs} ms (tri ${steps?.tri?.ms ?? '—'}, chargement ${steps?.chargement ?? '—'}, ` +
          `lecture ${steps?.lecture?.ms ?? '—'} ms/${steps?.lecture?.jetons ?? '—'} jetons, écriture ${steps?.ecriture?.ms ?? '—'}, ` +
          `outils ${steps?.outils?.map((tool) => `${tool.name}=${tool.ms}${tool.garde ? '*' : ''}`).join(' ') ?? '—'}) ${statut}`,
      );
    }

    const loaded = await ollama<Loaded>(baseUrl, '/api/ps');
    const run: BenchRun = {
      label,
      date: new Date().toISOString(),
      commit: commit(),
      loaded: (loaded?.models ?? []).map((model) => ({
        name: model.name,
        sizeMb: Math.round((model.size ?? 0) / 1_048_576),
        vramMb: Math.round((model.size_vram ?? 0) / 1_048_576),
      })),
      ...(warmupMs !== null ? { warmupMs } : {}),
      turns,
    };
    const dir = process.env.JARVIS_BANC_DIR ?? 'C:\\dev\\jarvis-data\\vitesse\\banc';
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${label}.json`);
    writeFileSync(target, `${JSON.stringify(run, null, 1)}\n`, 'utf8');
    console.log(`[banc] écrit : ${target}`);
    expect(turns).toHaveLength(demandes.length);
  },
  DEMANDES.length * TURN_DEADLINE_MS,
);
