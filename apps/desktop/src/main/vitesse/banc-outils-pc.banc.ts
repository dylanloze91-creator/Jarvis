/**
 * Banc des outils de l'équipe PC dans une discussion mélangée (défaut bloquant du 18 novembre).
 *
 *   npm run banc:outils-pc --workspace @jarvis/desktop
 *
 * Il rejoue, dans la vraie session de chat et avec le vrai Ollama, une discussion où des tours
 * répondus sans outil (une note, une explication) précèdent des demandes qui doivent appeler un
 * outil du PC, dont une qui agit (« Ouvre le Bloc-notes »). Il compte, pour chaque demande, si le
 * bon outil a été appelé. Il passe aussi les mêmes demandes en première phrase d'une discussion
 * neuve, pour comparer.
 *
 * Variables :
 *   JARVIS_BANC_PASSAGES=10        nombre de discussions rejouées (défaut 10)
 *   JARVIS_BANC_SANS=chauds,memoire   couper un outil de vitesse pour ce passage
 *   JARVIS_BANC_EDITION=live       table d'édition de Live (réglages de Live, lus seulement)
 *   JARVIS_BANC_LABEL=…            nom du fichier de résultat
 *   JARVIS_BANC_REPONSES=1         afficher les réponses (jamais enregistrées)
 *   JARVIS_BANC_DONNEES=1|perso|memoire|sans   voir plus bas
 *
 * Rien ne s'ouvre pour de vrai : `open_application` est remplacé par une réponse « ouvert » dans
 * le banc seulement, pour que la discussion continue comme quand l'utilisateur accepte la carte.
 * Les demandes sont écrites pour le banc : elles n'entrent dans aucune conversation de
 * l'utilisateur ni dans aucun jeu d'entraînement. Le résultat ne contient aucune phrase.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { ToolCallOutcome } from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-banc-outils-pc-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => 'banc', isPackaged: false },
  shell: { openExternal: async () => undefined, openPath: async () => '' },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

/**
 * Personnalisation du banc, pour toujours : un prénom et la règle « réponds court » que pose le
 * questionnaire « Faisons connaissance ». C'est avec elles que le défaut du 18 novembre apparaît ;
 * sans personnalisation, le banc ne le voyait pas (6 sur 6). Le prénom est inventé.
 */
const PERSONNALISATION_DU_BANC = {
  version: 1,
  assistant: {},
  user: { prenom: 'camille' },
  rules: ['Réponds court, en une ou deux phrases quand c’est possible.'],
  updatedAt: 0,
};
writeFileSync(join(userData, 'personalization.json'), JSON.stringify(PERSONNALISATION_DU_BANC), 'utf8');

// JARVIS_BANC_DONNEES=1|perso|memoire : partir en plus d'une copie de la personnalisation et de la
// mémoire apprise de l'édition (lues seulement ; la copie vit dans le dossier temporaire et
// disparaît à la fin). JARVIS_BANC_DONNEES=sans : aucune personnalisation, pour comparer.
const donnees = process.env.JARVIS_BANC_DONNEES ?? '';
if (donnees === 'sans') rmSync(join(userData, 'personalization.json'), { force: true });
else if (donnees) {
  const source = join(process.env.APPDATA ?? '', ...(process.env.JARVIS_BANC_EDITION === 'live' ? ['@jarvis', 'desktop'] : ['Jarvis Test']));
  // `perso` : la personnalisation seule ; `memoire` : la mémoire apprise seule ; `1` : les deux.
  const names = [
    ...(donnees === 'memoire' ? [] : ['personalization.json']),
    ...(donnees === 'perso' ? [] : ['knowledge-index.json', 'learning', 'memory']),
  ];
  for (const name of names) {
    if (existsSync(join(source, name))) cpSync(join(source, name), join(userData, name), { recursive: true });
  }
}

const core = await import('@jarvis/core');
const { NotesBook, expressNoteReply, notesFilePath, plainStateFileIO } = await import('@jarvis/core/quotidien/fichiers');
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

const TURN_DEADLINE_MS = 240_000;

interface Demande {
  id: string;
  text: string;
  /** Outil attendu. `null` : tour qui se répond sans outil. */
  outil: string | null;
}

/** La discussion mélangée : deux tours sans outil, puis trois demandes à l'équipe PC. */
const MELANGEE: Demande[] = [
  { id: 'note', text: 'Note : acheter des piles pour la télécommande', outil: null },
  { id: 'explication', text: 'Explique-moi en deux phrases ce qu’est un trou noir.', outil: null },
  { id: 'bloc-notes', text: 'Ouvre le Bloc-notes', outil: 'open_application' },
  { id: 'infos-pc', text: 'Donne-moi les informations sur mon PC', outil: 'get_system_info' },
  { id: 'fenetre', text: 'Quelle fenêtre est active ?', outil: 'get_active_window' },
];

/** Les mêmes demandes, chacune en première phrase d'une discussion neuve. */
const NEUVES: Demande[] = MELANGEE.filter((demande) => demande.outil).map((demande) => ({ ...demande, id: `${demande.id}-neuve` }));

interface Essai {
  passage: number;
  demande: string;
  team: string | null;
  how: string | null;
  attendu: string | null;
  outils: string[];
  /** Le bon outil a été appelé (ou aucun, pour un tour sans outil). */
  juste: boolean;
  ms: number;
  statut: 'ok' | 'erreur' | 'delai';
}

function reglages(dossier: string): ReturnType<typeof core.parseSettings> {
  const file = join(process.env.APPDATA ?? '', ...dossier.split('/'), 'settings.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  delete raw.images;
  delete raw.developer;
  raw.debugLogging = false;
  // La discussion mélangée commence par une note : la fonction est activée pour le banc.
  raw.notes = { enabled: true };
  return core.parseSettings(raw);
}

function commit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

it(
  'outils de l’équipe PC dans une discussion mélangée',
  async () => {
    const live = process.env.JARVIS_BANC_EDITION === 'live';
    process.env.JARVIS_EDITION = live ? 'live' : 'test';
    const sans = (process.env.JARVIS_BANC_SANS ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    const table = core.TEST_EDITION as { keepModelsWarm?: boolean; keepToolResults?: boolean };
    if (sans.includes('chauds')) table.keepModelsWarm = false;
    if (sans.includes('memoire')) table.keepToolResults = false;
    const passages = Math.max(1, Number(process.env.JARVIS_BANC_PASSAGES ?? 10) || 10);
    const label = (process.env.JARVIS_BANC_LABEL ?? `outils-pc-${live ? 'live' : 'test'}${sans.length ? `-sans-${sans.join('-')}` : ''}`).replace(
      /[^\w.-]+/g,
      '-',
    );
    const settings = reglages(live ? '@jarvis/desktop' : 'Jarvis Test');
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
    if (edition().keepToolResults) tools.useResultMemory(new core.ToolResultMemory());
    // Rien ne s'ouvre : l'ouverture d'une application est remplacée par une réussite, dans le banc seulement.
    const realExecute = tools.execute.bind(tools);
    tools.execute = async (call, context) => {
      if (call.name !== 'open_application') return realExecute(call, context);
      const outcome: ToolCallOutcome = {
        callId: call.id,
        name: call.name,
        status: 'ok',
        content: 'Application ouverte.',
        arguments: call.arguments,
        decision: 'allowed',
        durationMs: 1,
        outcome: 'success',
      } as unknown as ToolCallOutcome;
      return outcome;
    };
    const notesBook = new NotesBook(() => notesFilePath(userData), plainStateFileIO);
    const store = new core.InMemoryConversationStore();
    const session = new ChatSession({
      registry: core.createDefaultRegistry(),
      tools,
      store,
      auditLog: new core.InMemoryAuditLogStore(),
      getSettings,
      voice: { hasApiKey: () => false } as never,
      personalization: new PersonalizationStore(),
      knowledge,
      localLearning: stubLocalLearning(),
      notes: async (input) => {
        const intent = core.noteIntent(input.text);
        return intent ? expressNoteReply(notesBook, intent, input.place) : null;
      },
    });
    await benchStartup({ settings });

    const essais: Essai[] = [];
    const dire = async (passage: number, demande: Demande, conversationId: string | null): Promise<string | null> => {
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
        await session.send(sender, { conversationId, text: demande.text });
      } finally {
        clearTimeout(timer);
      }
      const ms = Date.now() - started;
      const done = events.find((event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done');
      const route = events.find((event): event is Extract<ChatEvent, { type: 'route' }> => event.type === 'route');
      const outils = events
        .filter((event): event is Extract<ChatEvent, { type: 'tool_start' }> => event.type === 'tool_start')
        .map((event) => event.toolName);
      const juste = demande.outil ? outils.includes(demande.outil) : outils.length === 0;
      const statut: Essai['statut'] = ms >= TURN_DEADLINE_MS ? 'delai' : events.some((event) => event.type === 'error') ? 'erreur' : 'ok';
      essais.push({
        passage,
        demande: demande.id,
        team: route?.team ?? null,
        how: route?.how ?? null,
        attendu: demande.outil,
        outils,
        juste,
        ms,
        statut,
      });
      console.log(
        `[banc] ${passage}/${passages} ${demande.id} ${route?.team ?? '—'}/${route?.how ?? '—'} : ` +
          `${outils.join(' ') || 'aucun outil'} ${juste ? 'JUSTE' : 'RATÉ'} ${ms} ms ${statut}`,
      );
      if (process.env.JARVIS_BANC_REPONSES === '1') {
        const reply = events
          .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
          .map((event) => event.text)
          .join('');
        console.log(`[réponse ${demande.id}] ${reply.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
      return done?.conversationId ?? conversationId;
    };

    for (let passage = 1; passage <= passages; passage += 1) {
      let conversationId: string | null = null;
      for (const demande of MELANGEE) conversationId = await dire(passage, demande, conversationId);
      for (const demande of NEUVES) await dire(passage, demande, null);
    }

    const bilan = [...MELANGEE, ...NEUVES]
      .filter((demande) => demande.outil)
      .map((demande) => {
        const lignes = essais.filter((essai) => essai.demande === demande.id);
        return { demande: demande.id, attendu: demande.outil, justes: lignes.filter((essai) => essai.juste).length, essais: lignes.length };
      });
    for (const ligne of bilan) console.log(`[bilan] ${ligne.demande} : ${ligne.justes}/${ligne.essais} (${ligne.attendu})`);

    const dir = process.env.JARVIS_BANC_DIR ?? 'C:\\dev\\jarvis-data\\vitesse\\banc';
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${label}.json`);
    writeFileSync(
      target,
      `${JSON.stringify({ label, date: new Date().toISOString(), commit: commit(), edition: edition().id, sans, donnees: donnees || 'banc', passages, bilan, essais }, null, 1)}\n`,
      'utf8',
    );
    console.log(`[banc] écrit : ${target}`);
    expect(essais).toHaveLength(passages * (MELANGEE.length + NEUVES.length));
  },
  60 * 60_000,
);
