/**
 * Banc des phrases de l'atelier 3D, en vrai (mission de nuit du 25 au 26 novembre).
 *
 *   npm run banc:phrases-atelier --workspace @jarvis/desktop
 *
 * Chaque discussion de `phrasesAtelier.ts` est dite dans la vraie session de chat de Jarvis Test :
 * vrai chef d'orchestre et vrai Ollama (réglages de Jarvis Test, lus seulement), vrai atelier, vrai
 * OpenSCAD, vrai OrcaSlicer (préréglages de l'utilisateur lus, jamais modifiés), vraie recherche web.
 * L'atelier travaille dans un dossier à part, avec ses propres données.
 *
 * **Rien n'est envoyé à l'imprimante** : l'adresse de l'imprimante est remplacée par une fausse
 * imprimante en mémoire (`FakeMoonraker`), et tous les outils du chat sont remplacés par une réponse
 * « fait (banc) » : rien ne s'ouvre, rien ne joue, Forge n'est pas lancé.
 *
 * Pour chaque phrase, trois contrôles : la bonne équipe (l'atelier, ou surtout pas lui), le bon
 * résultat (pièce, question, réponse), et une réponse juste (STL fermé et aux cotes attendues, ou
 * texte attendu). La durée est notée.
 *
 * Variables :
 *   JARVIS_ATELIER_SEULEMENT=id1,id2   ne passer que ces discussions (début d'identifiant accepté)
 *   JARVIS_ATELIER_SANS=lent,web       sauter les discussions marquées ainsi
 *   JARVIS_ATELIER_LABEL=avant         nom du fichier de résultat
 *   JARVIS_ATELIER_DIR=…               dossier des résultats (défaut C:\dev\jarvis-data\atelier-nuit)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { AtelierEtat, ToolCallOutcome } from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';
import { FakeMoonraker } from '../../../../../packages/core/src/quotidien/fakeMoonraker.testkit.js';
import { DISCUSSIONS, type Attendu, type TourEssai } from './phrasesAtelier.js';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-phrases-atelier-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => 'banc', isPackaged: false },
  shell: { openExternal: async () => undefined, openPath: async () => '' },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

process.env.JARVIS_EDITION = process.env.JARVIS_ATELIER_EDITION === 'live' ? 'live' : 'test';
const core = await import('@jarvis/core');
const { createToolManager } = await import('../tools/index.js');
const { ChatSession } = await import('../session.js');
const { SpotifyBridge } = await import('../media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('../siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('../personalization.js');
const { KnowledgeStore } = await import('../knowledge.js');
const { stubLocalLearning } = await import('../test/localLearningStub.js');
const { creerAtelierPC, ORCA_RACINE } = await import('./atelierPC.js');
const { edition } = await import('../edition.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

const TURN_DEADLINE_MS = 12 * 60_000;
const FAUSSE_IMPRIMANTE = 'http://imprimante-factice.local';

function reglages(): ReturnType<typeof core.parseSettings> {
  const raw = JSON.parse(readFileSync(join(process.env.APPDATA ?? '', 'Jarvis Test', 'settings.json'), 'utf8')) as Record<string, unknown>;
  delete raw.developer;
  raw.debugLogging = false;
  // Jamais la vraie imprimante : une fausse, en mémoire.
  raw.printer = { enabled: true, baseUrl: FAUSSE_IMPRIMANTE };
  return core.parseSettings(raw);
}

function commit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

interface Ligne {
  discussion: string;
  fonction: string;
  tour: number;
  phrase: string;
  lieu: string;
  ok: boolean;
  pourquoi: string;
  /** « atelier », ou l'équipe du chef d'orchestre. */
  equipe: string;
  comment: string | null;
  outils: string[];
  ms: number;
  reponse: string;
}

type Piece = Extract<AtelierEtat, { etape: 'piece' }>;

function versionChoisie(etat: Piece) {
  return etat.versions.find((v) => v.numero === etat.versionChoisie) ?? etat.versions.at(-1);
}

/** Contrôle d'un tour : `null` si tout est bon, sinon la raison. */
function controler(attendu: Attendu, sortie: { texte: string; etat?: AtelierEtat } | null | undefined, racine: string, reponse: string): string | null {
  if ('ailleurs' in attendu) {
    if (sortie) return `pris par l'atelier (« ${sortie.texte.slice(0, 80)} »)`;
    if (attendu.dit && !attendu.dit.test(reponse)) return `réponse inattendue (${attendu.dit})`;
    return null;
  }
  if (!sortie) return "pas pris par l'atelier";
  const texte = sortie.texte;
  if (attendu.dit && !attendu.dit.test(texte)) return `texte inattendu (${attendu.dit})`;
  if (attendu.pasDit && attendu.pasDit.test(texte)) return `texte interdit (${attendu.pasDit})`;
  if ('piece' in attendu) {
    const etat = sortie.etat;
    if (etat?.etape !== 'piece') return `pas de pièce (état ${etat?.etape ?? 'aucun'})`;
    const v = versionChoisie(etat);
    if (!v) return 'aucune version';
    const g = v.gabarit ?? etat.gabarit;
    if (g !== attendu.piece) return `pièce « ${g} » au lieu de « ${attendu.piece} »`;
    if (attendu.version !== undefined && v.numero !== attendu.version) return `version ${v.numero} au lieu de ${attendu.version}`;
    if (!v.stl) return 'pas de STL';
    const fichier = join(racine, etat.dossier, v.stl);
    if (!existsSync(fichier)) return `STL absent (${v.stl})`;
    // Un ensemble (boîtier à écran) : le STL monté n'est pas une seule coque, chaque pièce est contrôlée.
    const aControler = v.pieces?.length ? v.pieces.map((p) => ({ stl: p.stl, taille: p.taille })) : [{ stl: v.stl, taille: v.taille }];
    for (const p of aControler) {
      const controle = core.controlerStl(core.lireStl(readFileSync(join(racine, etat.dossier, p.stl))), p.taille);
      if (!controle.ok) return `STL ${p.stl} : ${controle.problemes.join(' ')}`;
    }
    if (attendu.taille) {
      for (let i = 0; i < 3; i += 1) {
        const voulu = attendu.taille[i];
        if (voulu !== null && voulu !== undefined && Math.abs(v.taille[i]! - voulu) > (attendu.tolerance ?? 0.6)) {
          return `taille ${v.taille.map((x) => Math.round(x * 10) / 10).join(' × ')} au lieu de ${attendu.taille.map((x) => x ?? '·').join(' × ')}`;
        }
      }
    }
    if (attendu.mesures) {
      const fiche = `${v.fiche} ${v.mesures.map((m) => `${m.nom} : ${m.valeur}`).join(' ; ')}`;
      if (!attendu.mesures.test(fiche)) return `mesures inattendues (${attendu.mesures}) : ${fiche.slice(0, 160)}`;
    }
    return null;
  }
  if ('question' in attendu) {
    if (sortie.etat?.etape === 'piece') return 'une pièce au lieu d’une question';
    if (!attendu.question.test(texte)) return `question inattendue (${attendu.question})`;
    return null;
  }
  return null;
}

it(
  'phrases de l’atelier, en vrai',
  async () => {
    const seulement = (process.env.JARVIS_ATELIER_SEULEMENT ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const sans = (process.env.JARVIS_ATELIER_SANS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const label = (process.env.JARVIS_ATELIER_LABEL ?? 'passage').replace(/[^\w.-]+/g, '-');
    const dir = process.env.JARVIS_ATELIER_DIR ?? 'C:\\dev\\jarvis-data\\atelier-nuit';
    const racine = join(dir, `racine-${label}`);
    rmSync(racine, { recursive: true, force: true });
    mkdirSync(racine, { recursive: true });
    expect(edition().atelier).toBe(true);

    const settings = reglages();
    const getSettings = () => settings;
    const imprimante = new FakeMoonraker();
    const vraiFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(FAUSSE_IMPRIMANTE)) return imprimante.fetch(input, init);
      // Garde de la nuit : aucune autre adresse d'imprimante ne doit jamais être jointe.
      if (/mainsailos|:7125\b/.test(url)) throw new Error(`banc : appel refusé vers ${url}`);
      return vraiFetch(input, init);
    }) as typeof fetch;

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
    // Aucun outil du chat n'agit pour de vrai.
    tools.execute = async (call) =>
      ({
        callId: call.id,
        name: call.name,
        status: 'ok',
        content: 'Fait (banc : rien n’a été fait pour de vrai).',
        arguments: call.arguments,
        decision: 'allowed',
        durationMs: 1,
        outcome: 'success',
      }) as unknown as ToolCallOutcome;

    const atelierPC = creerAtelierPC(getSettings, racine, ORCA_RACINE, searchRegistry);
    const boite: { sortie: { texte: string; etat?: AtelierEtat } | null | undefined } = { sortie: undefined };
    let accord = false;
    const cartes: string[] = [];
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
      atelier: async (input) => {
        boite.sortie = await atelierPC(input);
        return boite.sortie;
      },
    });

    const lignes: Ligne[] = [];
    const choisies = DISCUSSIONS.filter(
      (d) => (!seulement.length || seulement.some((s) => d.id.startsWith(s))) && !(d.marques ?? []).some((m) => sans.includes(m)),
    );
    for (const discussion of choisies) {
      // Chaque discussion part de données neuves (mesures et cotes de composants), sauf demande contraire.
      if (!discussion.gardeMesures) {
        for (const f of ['composants-mesures.json', 'composants-cotes.json']) rmSync(join(racine, f), { force: true });
      }
      imprimante.status = { ...imprimante.status, state: discussion.imprimanteOccupee ? 'printing' : 'standby' };
      imprimante.queue = [];
      imprimante.queueState = 'paused';
      let conversationId: string | null = null;
      for (const [index, tour] of discussion.tours.entries()) {
        const essai: TourEssai = tour;
        const events: ChatEvent[] = [];
        boite.sortie = undefined;
        accord = essai.accord ?? false;
        const sender = {
          isDestroyed: () => false,
          send: (_channel: string, event: ChatEvent) => {
            events.push(event);
            if (event.type === 'confirm') {
              cartes.push(event.details);
              session.respondConfirmation(event.requestId, event.toolName === 'atelier' ? accord : false);
            }
          },
        } as unknown as Electron.WebContents;
        const timer = setTimeout(() => session.cancel(), TURN_DEADLINE_MS);
        const avant = imprimante.calls.length;
        const started = Date.now();
        const lieu = essai.lieu ?? 'fenetre';
        try {
          await session.send(sender, {
            conversationId,
            text: essai.dire,
            ...(lieu === 'enceinte' ? { source: 'voice' as const, place: { kind: 'enceinte' as const, name: 'banc' } } : {}),
            ...(lieu === 'telephone' ? { place: { kind: 'telephone' as const } } : {}),
          });
        } catch (error) {
          events.push({ type: 'error', message: String(error) } as ChatEvent);
        } finally {
          clearTimeout(timer);
        }
        const ms = Date.now() - started;
        const done = events.find((event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done');
        const route = events.find((event): event is Extract<ChatEvent, { type: 'route' }> => event.type === 'route');
        const outils = events
          .filter((event): event is Extract<ChatEvent, { type: 'tool_start' }> => event.type === 'tool_start')
          .map((event) => event.toolName);
        const reponse = events
          .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
          .map((event) => event.text)
          .join('')
          .replace(/\s+/g, ' ');
        const appels = imprimante.calls.slice(avant);
        const sortieAtelier = boite.sortie as { texte: string; etat?: AtelierEtat } | null | undefined;
        let pourquoi = controler(essai.attendu, sortieAtelier, racine, reponse);
        if (!pourquoi && ms >= TURN_DEADLINE_MS) pourquoi = 'délai dépassé';
        if (!pourquoi && essai.imprimante && !appels.some((a) => essai.imprimante!.test(a))) pourquoi = `imprimante : appel attendu ${essai.imprimante} (${appels.join(', ') || 'aucun'})`;
        if (!pourquoi && essai.pasImprimante && appels.some((a) => essai.pasImprimante!.test(a))) pourquoi = `imprimante : appel interdit ${essai.pasImprimante} (${appels.join(', ')})`;
        const ligne: Ligne = {
          discussion: discussion.id,
          fonction: discussion.fonction,
          tour: index + 1,
          phrase: essai.dire,
          lieu,
          ok: !pourquoi,
          pourquoi: pourquoi ?? '',
          equipe: sortieAtelier ? 'atelier' : (route?.team ?? '—'),
          comment: sortieAtelier ? 'règles' : (route?.how ?? null),
          outils,
          ms,
          reponse: (sortieAtelier?.texte ?? reponse).slice(0, 700),
        };
        lignes.push(ligne);
        console.log(
          `[atelier] ${ligne.ok ? 'OK  ' : 'RATÉ'} ${discussion.id} #${index + 1} (${ligne.equipe}, ${(ms / 1000).toFixed(1)} s) « ${essai.dire} »${pourquoi ? ` → ${pourquoi}` : ''}`,
        );
        if (pourquoi || process.env.JARVIS_ATELIER_REPONSES === '1') console.log(`          ↳ ${ligne.reponse.slice(0, 400)}`);
        conversationId = done?.conversationId ?? conversationId;
      }
    }
    globalThis.fetch = vraiFetch;

    const total = lignes.length;
    const bons = lignes.filter((l) => l.ok).length;
    const parFonction = new Map<string, { ok: number; total: number }>();
    for (const l of lignes) {
      const f = parFonction.get(l.fonction) ?? { ok: 0, total: 0 };
      f.total += 1;
      if (l.ok) f.ok += 1;
      parFonction.set(l.fonction, f);
    }
    for (const [fonction, f] of parFonction) console.log(`[bilan] ${fonction} : ${f.ok}/${f.total}`);
    console.log(`[bilan] TOTAL ${bons}/${total}`);
    mkdirSync(dir, { recursive: true });
    const cible = join(dir, `resultats-${label}.json`);
    writeFileSync(
      cible,
      `${JSON.stringify({ label, date: new Date().toISOString(), commit: commit(), total, bons, parFonction: Object.fromEntries(parFonction), lignes, cartes }, null, 1)}\n`,
      'utf8',
    );
    console.log(`[atelier] écrit : ${cible}`);
    expect(total).toBeGreaterThan(0);
  },
  12 * 60 * 60_000,
);
