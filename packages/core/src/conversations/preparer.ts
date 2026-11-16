/**
 * Préparation du jeu d'entraînement tiré des conversations.
 * Aucun modèle, aucun réseau. Les sources sont lues, jamais écrites.
 * Les sorties vont dans `<dir>/conversations/`, jamais dans le dépôt.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { TEAM_SPECS, ORCHESTRA_TEAMS, type OrchestraTeam } from '../agent/orchestraTeams.js';
import { routerUserPrompt } from '../agent/orchestra.js';
import { classifyUtterance } from '../learning/continuous.js';
import { evalCatalog } from '../developer/labCatalog.js';
import { redactSecrets } from '../security/redact.js';
import { listExamFiles } from '../trieur/files.js';
import { normalizePhrase, parseExamLine, phraseKey } from '../trieur/extract.js';
import { buildTrainingLine } from '../trieur/generator.js';
import { parseTrainingLine } from '../trieur/trainPrep.js';
import type { ChatMessage, TurnLogEntry } from '../types.js';

export const DIR_DEFAUT = 'C:\\dev\\jarvis-data';
export const SEED_DEFAUT = 5066;
export const VALIDATION_DEFAUT = 0.1;

const VERS_CORRIGER = new Set(['correction', 'repetition', 'interruption', 'outil_echec', 'signale', 'chemin']);
const OUTILS_PERSO = new Set([
  'read_file',
  'search_jarvis_memory',
  'get_jarvis_personalization',
  'set_jarvis_personalization',
  'add_jarvis_personalization_rule',
  'forget_jarvis_personalization',
  'reset_jarvis_personalization',
]);

export function modeleOuvert(model: string | null | undefined): boolean {
  if (!model?.trim()) return false;
  return /^(?:qwen|ornith|jarvis-)/i.test(model.trim());
}

/** L'utilisateur ou un modèle ouvert. `claude` (et tout nom qui le contient) est refusé. */
export function correctionAcceptee(correctedBy: string | null | undefined): boolean {
  if (!correctedBy?.trim()) return false;
  const nom = correctedBy.trim().toLowerCase();
  if (nom.includes('claude')) return false;
  if (nom === 'utilisateur' || nom === 'user') return true;
  return modeleOuvert(correctedBy.trim());
}

export function outilPersonnel(name: string): boolean {
  return name.startsWith('google_') || OUTILS_PERSO.has(name) || name.includes('personalization');
}

function estDedans(parent: string, enfant: string): boolean {
  const base = resolve(parent);
  const cible = resolve(enfant);
  const rel = relative(base, cible);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** La sortie ne recouvre pas une source, et ne tombe pas dans le dépôt. */
export function refuserSortie(sortie: string, sources: readonly string[], depot?: string): void {
  for (const source of sources) {
    if (!source) continue;
    if (estDedans(source, sortie) || estDedans(sortie, source)) {
      throw new Error('la sortie ne peut pas recouvrir une source');
    }
  }
  if (depot && estDedans(depot, sortie)) {
    throw new Error('la sortie ne peut pas être dans le dépôt');
  }
}

export interface ResumePreparation {
  seed: number;
  validation: number;
  conversations: { lues: number; sautees: number; absentes: number };
  carnet: { lignes: number; ignorees: number; absent: boolean };
  parSource: Record<string, number>;
  parEquipe: Record<string, number>;
  parModele: Record<string, number>;
  parRaison: Record<string, number>;
  gardes: { trieur: number; reponses: number; aCorriger: number };
  validationLots: { entrainement: number; validation: number };
  ecartes: number;
  doublons: number;
  correctionsClaudeRefusees: number;
}

export interface FichiersPreparation {
  trieur: string;
  reponses: string;
  aCorriger: string;
  ecartes: string;
  resume: string;
}

export interface ResultatPreparation {
  resume: ResumePreparation;
  fichiers: FichiersPreparation;
  trieur: string[];
  reponses: string[];
  aCorriger: string[];
  ecartes: string[];
}

interface NoteCarnet {
  type: string;
  correction: string;
  correctedBy: string | null;
}

interface Tour {
  conversationId: string;
  synthetique: boolean;
  userMessageId: string;
  userText: string;
  history: ChatMessage[];
  turn: ChatMessage[];
  journal: TurnLogEntry | null;
  routeTeam: string | null;
  routeHow: string | null;
  nextUserText: string | null;
}

function compter(map: Record<string, number>, cle: string): void {
  map[cle] = (map[cle] ?? 0) + 1;
}

function synthetique(row: Record<string, unknown>): boolean {
  if (row['synthetique-test'] === true) return true;
  const meta = row.meta;
  return Boolean(meta && typeof meta === 'object' && (meta as Record<string, unknown>)['synthetique-test'] === true);
}

function messageDe(raw: unknown, index: number): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const role = row.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'system') return null;
  const toolCalls = Array.isArray(row.toolCalls)
    ? row.toolCalls
        .filter((item) => item && typeof item === 'object')
        .map((item, callIndex) => {
          const call = item as Record<string, unknown>;
          const name = typeof call.name === 'string' ? call.name : '';
          const args = call.arguments && typeof call.arguments === 'object' ? (call.arguments as Record<string, unknown>) : {};
          return { id: typeof call.id === 'string' ? call.id : `appel-${callIndex}`, name, arguments: args };
        })
        .filter((call) => call.name)
    : undefined;
  return {
    id: typeof row.id === 'string' && row.id ? row.id : `m${index}`,
    role,
    content: typeof row.content === 'string' ? row.content : '',
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    ...(typeof row.toolName === 'string' ? { toolName: row.toolName } : {}),
    ...(typeof row.toolStatus === 'string' ? { toolStatus: row.toolStatus as ChatMessage['toolStatus'] } : {}),
    ...(typeof row.toolCallId === 'string' ? { toolCallId: row.toolCallId } : {}),
    ...(toolCalls?.length ? { toolCalls } : {}),
  };
}

function toursDe(raw: unknown): { tours: Tour[]; sautee: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { tours: [], sautee: true };
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.messages)) return { tours: [], sautee: true };
  const messages = row.messages.map((item, index) => messageDe(item, index)).filter((item): item is ChatMessage => item !== null);
  const id = typeof row.id === 'string' && row.id ? row.id : 'conversation';
  const marque = synthetique(row);
  const journaux = new Map<string, TurnLogEntry>();
  if (Array.isArray(row.turnLog)) {
    for (const item of row.turnLog) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as TurnLogEntry;
      if (typeof entry.userMessageId === 'string' && entry.userMessageId) journaux.set(entry.userMessageId, entry);
    }
  }
  const routes = new Map<string, { team: string | null; how: string | null }>();
  if (Array.isArray(row.routeLog)) {
    for (const item of row.routeLog) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const userMessageId = typeof entry.userMessageId === 'string' ? entry.userMessageId : '';
      if (!userMessageId) continue;
      routes.set(userMessageId, {
        team: typeof entry.team === 'string' ? entry.team : null,
        how: typeof entry.how === 'string' ? entry.how : null,
      });
    }
  }
  const users = messages.map((message, index) => ({ message, index })).filter((item) => item.message.role === 'user');
  const tours: Tour[] = users.map((item, order) => {
    const fin = users[order + 1]?.index ?? messages.length;
    const next = users[order + 1]?.message.content ?? null;
    const route = routes.get(item.message.id);
    return {
      conversationId: id,
      synthetique: marque,
      userMessageId: item.message.id,
      userText: item.message.content,
      history: messages.slice(0, item.index),
      turn: messages.slice(item.index, fin),
      journal: journaux.get(item.message.id) ?? null,
      routeTeam: route?.team ?? null,
      routeHow: route?.how ?? null,
      nextUserText: next,
    };
  });
  return { tours, sautee: false };
}

function parserCarnet(line: string): { note: NoteCarnet; conversationId: string; userText: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.type !== 'string' || typeof row.userText !== 'string' || !row.userText.trim()) return null;
  if (typeof row.conversationId !== 'string' || !row.conversationId) return null;
  return {
    conversationId: row.conversationId,
    userText: row.userText,
    note: {
      type: row.type,
      correction: typeof row.correction === 'string' ? row.correction : '',
      correctedBy: typeof row.correctedBy === 'string' ? row.correctedBy : null,
    },
  };
}

function nomsOutils(tour: Tour): string[] {
  const noms = new Set<string>();
  for (const message of tour.turn) {
    if (message.role === 'tool' && message.toolName) noms.add(message.toolName);
    for (const call of message.toolCalls ?? []) noms.add(call.name);
  }
  for (const tool of tour.journal?.tools ?? []) if (tool.name) noms.add(tool.name);
  return [...noms];
}

function sansToursRates(history: readonly ChatMessage[], rates: ReadonlySet<string>): ChatMessage[] {
  const gardes: ChatMessage[] = [];
  let sauter = false;
  for (const message of history) {
    if (message.role === 'user') sauter = rates.has(message.id);
    if (!sauter) gardes.push(message);
  }
  return gardes;
}

function quatreEchanges(history: readonly ChatMessage[]): ChatMessage[] {
  const starts: number[] = [];
  history.forEach((message, index) => {
    if (message.role === 'user') starts.push(index);
  });
  const garder = starts.slice(-4);
  if (!garder.length) return [];
  return history.slice(garder[0]);
}

function ligneMessage(message: ChatMessage): Record<string, unknown> | null {
  if (message.role === 'user' || message.role === 'assistant') {
    const content = redactSecrets(message.content);
    const row: Record<string, unknown> = { role: message.role, content };
    if (message.role === 'assistant' && message.toolCalls?.length) {
      row.tool_calls = message.toolCalls.map((call) => ({
        type: 'function',
        function: {
          name: call.name,
          arguments: redactSecrets(JSON.stringify(call.arguments ?? {})),
        },
      }));
    }
    return row;
  }
  if (message.role === 'tool') {
    return {
      role: 'tool',
      name: message.toolName ?? '',
      content: redactSecrets(message.content),
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    };
  }
  return null;
}

function systemeCourt(team: string | null): string {
  if (team && ORCHESTRA_TEAMS.includes(team as OrchestraTeam)) return TEAM_SPECS[team as OrchestraTeam].prompt;
  return 'Tu es Jarvis.';
}

function catalogue(team: string | null): { name: string }[] {
  if (!team || !ORCHESTRA_TEAMS.includes(team as OrchestraTeam)) return [];
  return TEAM_SPECS[team as OrchestraTeam].tools.map((name) => ({ name }));
}

function aUneReponse(tour: Tour): boolean {
  return tour.turn.some(
    (message) =>
      (message.role === 'assistant' && (message.content.trim() || (message.toolCalls?.length ?? 0) > 0)) ||
      message.role === 'tool',
  );
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function lotsDesConversations(ids: readonly string[], seed: number, part: number): Map<string, 'entrainement' | 'validation'> {
  const liste = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  const rng = mulberry32(seed);
  for (let i = liste.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = liste[i]!;
    liste[i] = liste[j]!;
    liste[j] = tmp;
  }
  const partValide = Math.min(1, Math.max(0, part));
  const n = Math.floor(liste.length * partValide);
  const validation = new Set(liste.slice(0, n));
  return new Map(liste.map((id) => [id, validation.has(id) ? 'validation' : 'entrainement']));
}

function marquer(row: Record<string, unknown>, tour: Tour): Record<string, unknown> {
  if (!tour.synthetique) return row;
  return { ...row, 'synthetique-test': true };
}

export function phrasesExamen(examens: readonly { phrase: string }[]): Set<string> {
  const set = new Set<string>();
  for (const row of examens) {
    const phrase = normalizePhrase(row.phrase);
    if (phrase) set.add(phrase);
  }
  for (const entry of evalCatalog()) {
    const goal = normalizePhrase(entry.mission.goal);
    if (goal) set.add(goal);
  }
  return set;
}

export interface EntreePreparation {
  conversations: readonly unknown[];
  carnet?: readonly string[];
  examens?: readonly { phrase: string }[];
  validation?: number;
  seed?: number;
  sauteesFichiers?: number;
  carnetIgnorees?: number;
  carnetAbsent?: boolean;
  conversationsAbsentes?: number;
}

/**
 * Classe des conversations déjà lues. N'écrit rien.
 * Une réponse n'est gardée que si le journal dit `ollama` et un modèle ouvert.
 */
export function classerConversations(entree: EntreePreparation): Omit<ResultatPreparation, 'fichiers'> {
  const seed = entree.seed ?? SEED_DEFAUT;
  const validation = entree.validation ?? VALIDATION_DEFAUT;
  const examens = phrasesExamen(entree.examens ?? []);
  const resume: ResumePreparation = {
    seed,
    validation,
    conversations: {
      lues: 0,
      sautees: entree.sauteesFichiers ?? 0,
      absentes: entree.conversationsAbsentes ?? 0,
    },
    carnet: { lignes: 0, ignorees: entree.carnetIgnorees ?? 0, absent: entree.carnetAbsent ?? false },
    parSource: {},
    parEquipe: {},
    parModele: {},
    parRaison: {},
    gardes: { trieur: 0, reponses: 0, aCorriger: 0 },
    validationLots: { entrainement: 0, validation: 0 },
    ecartes: 0,
    doublons: 0,
    correctionsClaudeRefusees: 0,
  };
  if ((entree.sauteesFichiers ?? 0) > 0) resume.parRaison['fichier abîmé'] = entree.sauteesFichiers ?? 0;
  if ((entree.carnetIgnorees ?? 0) > 0) resume.parRaison['ligne illisible'] = entree.carnetIgnorees ?? 0;

  const carnet = new Map<string, NoteCarnet[]>();
  for (const line of entree.carnet ?? []) {
    if (!line.trim()) continue;
    const note = parserCarnet(line);
    if (!note) {
      resume.carnet.ignorees += 1;
      compter(resume.parRaison, 'ligne illisible');
      continue;
    }
    resume.carnet.lignes += 1;
    const cle = `${note.conversationId}\n${normalizePhrase(note.userText)}`;
    const liste = carnet.get(cle) ?? [];
    liste.push(note.note);
    carnet.set(cle, liste);
  }

  const causeDe = (tour: Tour): string | null => {
    const notes = carnet.get(`${tour.conversationId}\n${normalizePhrase(tour.userText)}`) ?? [];
    const types = notes.map((note) => note.type);
    const causeCarnet = types.find((type) => VERS_CORRIGER.has(type)) ?? null;
    const suivi = classifyUtterance(tour.nextUserText ?? '') === 'correction';
    return causeCarnet ?? (suivi ? 'correction' : null);
  };

  const tours: Tour[] = [];
  for (const raw of entree.conversations) {
    const lu = toursDe(raw);
    if (lu.sautee) {
      resume.conversations.sautees += 1;
      compter(resume.parRaison, 'fichier abîmé');
      continue;
    }
    resume.conversations.lues += 1;
    tours.push(...lu.tours);
  }

  interface Ligne {
    conversationId: string;
    json: Record<string, unknown>;
    cle: string;
  }
  const trieur: Ligne[] = [];
  const reponses: Ligne[] = [];
  const aCorriger: Record<string, unknown>[] = [];
  const ecartes: Record<string, unknown>[] = [];
  const rates = new Map<string, Set<string>>();
  for (const tour of tours) {
    if (!causeDe(tour)) continue;
    const ensemble = rates.get(tour.conversationId) ?? new Set<string>();
    ensemble.add(tour.userMessageId);
    rates.set(tour.conversationId, ensemble);
  }

  const vusTrieur = new Set<string>();
  const vusReponses = new Set<string>();

  const ecarter = (tour: Tour, raison: string): void => {
    compter(resume.parRaison, raison);
    resume.ecartes += 1;
    if (raison === 'doublon exact') resume.doublons += 1;
    ecartes.push(marquer({ conversationId: tour.conversationId, userMessageId: tour.userMessageId, raison, source: tour.journal?.source ?? 'texte' }, tour));
  };

  for (const tour of tours) {
    const phrase = normalizePhrase(redactSecrets(tour.userText));
    const journal = tour.journal;
    const team = journal?.team ?? tour.routeTeam;
    const how = journal?.how ?? tour.routeHow;
    const source = journal?.source ?? 'texte';
    const modele = journal?.model ?? null;
    compter(resume.parSource, source);
    if (team) compter(resume.parEquipe, team);
    compter(resume.parModele, modele ?? 'aucun');

    const notes = carnet.get(`${tour.conversationId}\n${normalizePhrase(tour.userText)}`) ?? [];
    const cause = causeDe(tour);
    const chemin = notes.some((note) => note.type === 'chemin');
    const examen = Boolean(phrase) && examens.has(phrase);
    const personnel = nomsOutils(tour).some((name) => outilPersonnel(name));
    const reponseOuverte = Boolean(journal) && journal?.provider === 'ollama' && modeleOuvert(journal?.model);

    let correction = '';
    let correctedBy: string | null = null;
    for (const note of notes) {
      if (!note.correction.trim()) continue;
      if (!correctionAcceptee(note.correctedBy)) {
        const claude = (note.correctedBy ?? '').toLowerCase().includes('claude');
        if (claude) resume.correctionsClaudeRefusees += 1;
        ecarter(tour, claude ? 'correction claude' : 'correction refusée');
        continue;
      }
      correction = redactSecrets(note.correction);
      correctedBy = note.correctedBy;
    }

    if (examen) ecarter(tour, "phrase d'examen");

    if (cause) {
      const contexte = [...quatreEchanges(tour.history), ...tour.turn]
        .map((message) => ligneMessage(message))
        .filter((message): message is Record<string, unknown> => message !== null);
      aCorriger.push(
        marquer(
          {
            id: `corriger-${tour.conversationId}-${tour.userMessageId}`,
            conversationId: tour.conversationId,
            userMessageId: tour.userMessageId,
            cause,
            team,
            how,
            model: modele,
            provider: journal?.provider ?? null,
            source,
            outils: nomsOutils(tour),
            contexte,
            correction,
            correctedBy,
          },
          tour,
        ),
      );
    }

    const equipe = team && ORCHESTRA_TEAMS.includes(team as OrchestraTeam) ? (team as OrchestraTeam) : null;
    if (!examen && !chemin && equipe && phrase) {
      const historique = sansToursRates(tour.history, rates.get(tour.conversationId) ?? new Set()).map((message) => ({
        ...message,
        content: redactSecrets(message.content),
      }));
      const context = redactSecrets(routerUserPrompt(phrase, historique));
      const cle = phraseKey(phrase, context);
      if (vusTrieur.has(cle)) {
        ecarter(tour, 'doublon exact');
      } else {
        vusTrieur.add(cle);
        const exemple = buildTrainingLine(equipe, phrase, context, [...ORCHESTRA_TEAMS], {
          team: equipe,
          style: 'short',
          length: 'short',
        });
        const verifie = parseTrainingLine({ ...exemple, id: `trieur-${cle}` });
        if ('error' in verifie) {
          ecarter(tour, verifie.error);
        } else {
          trieur.push({
            conversationId: tour.conversationId,
            cle,
            json: marquer({ ...exemple, id: `trieur-${cle}` }, tour),
          });
        }
      }
    }

    if (cause || examen) continue;
    if (!reponseOuverte) {
      ecarter(tour, 'modèle inconnu');
      continue;
    }
    if (personnel) {
      ecarter(tour, 'contenu personnel');
      continue;
    }
    if (!aUneReponse(tour)) {
      ecarter(tour, 'réponse vide');
      continue;
    }
    const messages = [
      { role: 'system', content: systemeCourt(team) },
      ...quatreEchanges(sansToursRates(tour.history, rates.get(tour.conversationId) ?? new Set())).map((message) =>
        ligneMessage(message),
      ),
      ...tour.turn.map((message) => ligneMessage(message)),
    ].filter((message): message is Record<string, unknown> => message !== null);
    const reply = tour.turn
      .filter((message) => message.role === 'assistant')
      .map((message) => redactSecrets(message.content))
      .join('\n');
    const cle = phraseKey(`${phrase}\n${reply}`, team ?? '');
    if (vusReponses.has(cle)) {
      ecarter(tour, 'doublon exact');
      continue;
    }
    vusReponses.add(cle);
    reponses.push({
      conversationId: tour.conversationId,
      cle,
      json: marquer(
        {
          id: `reponse-${tour.conversationId}-${tour.userMessageId}`,
          team,
          model: modele,
          provider: 'ollama',
          conversationId: tour.conversationId,
          messages,
          tools: catalogue(team),
        },
        tour,
      ),
    });
  }

  const ids = [...new Set([...trieur, ...reponses].map((ligne) => ligne.conversationId))];
  const lots = lotsDesConversations(ids, seed, validation);
  const poser = (ligne: Ligne): string => {
    const lot = lots.get(ligne.conversationId) ?? 'entrainement';
    compter(resume.validationLots, lot);
    return JSON.stringify({ ...ligne.json, lot });
  };
  const trieurLignes = trieur.map(poser);
  const reponseLignes = reponses.map(poser);
  resume.gardes.trieur = trieurLignes.length;
  resume.gardes.reponses = reponseLignes.length;
  resume.gardes.aCorriger = aCorriger.length;

  return {
    resume,
    trieur: trieurLignes,
    reponses: reponseLignes,
    aCorriger: aCorriger.map((ligne) => JSON.stringify(ligne)),
    ecartes: ecartes.map((ligne) => JSON.stringify(ligne)),
  };
}

function ecrireJsonl(lignes: readonly string[]): string {
  return lignes.length ? `${lignes.join('\n')}\n` : '';
}

export function fichiersPreparation(dir: string): FichiersPreparation {
  const base = join(resolve(dir), 'conversations');
  return {
    trieur: join(base, 'trieur.jsonl'),
    reponses: join(base, 'reponses.jsonl'),
    aCorriger: join(base, 'a-corriger.jsonl'),
    ecartes: join(base, 'ecartes.jsonl'),
    resume: join(base, 'resume.json'),
  };
}

async function fichierDeZeros(path: string): Promise<boolean> {
  const buf = await readFile(path);
  return buf.length > 0 && buf.every((octet) => octet === 0);
}

export async function lireExamensDuTrieur(dir: string): Promise<{ phrase: string }[]> {
  const dossier = join(resolve(dir), 'trieur');
  let entries: string[];
  try {
    entries = await readdir(dossier);
  } catch {
    return [];
  }
  const phrases: { phrase: string }[] = [];
  for (const file of listExamFiles(dossier, entries)) {
    let raw = '';
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = parseExamLine(JSON.parse(line));
        if (parsed?.phrase) phrases.push({ phrase: parsed.phrase });
      } catch {
        // Ligne d'examen illisible : sautée, le reste est lu.
      }
    }
  }
  return phrases;
}

export interface OptionsPreparation {
  conversations?: readonly string[];
  carnet?: string;
  dir?: string;
  validation?: number;
  seed?: number;
  /** Racine du dépôt git : refuser d'y écrire. */
  depot?: string;
  ecrire?: boolean;
}

export async function preparerConversations(options: OptionsPreparation = {}): Promise<ResultatPreparation> {
  const dir = options.dir ?? DIR_DEFAUT;
  const fichiers = fichiersPreparation(dir);
  const sources = [...(options.conversations ?? [])];
  if (options.carnet) sources.push(options.carnet);
  if (options.ecrire !== false) refuserSortie(join(resolve(dir), 'conversations'), sources, options.depot);

  const conversations: unknown[] = [];
  let sauteesFichiers = 0;
  let absentes = 0;
  for (const dossier of options.conversations ?? []) {
    let entries: string[];
    try {
      entries = await readdir(dossier);
    } catch {
      absentes += 1;
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const path = join(dossier, name);
      try {
        if (await fichierDeZeros(path)) {
          sauteesFichiers += 1;
          continue;
        }
        conversations.push(JSON.parse(await readFile(path, 'utf8')) as unknown);
      } catch {
        sauteesFichiers += 1;
      }
    }
  }

  let carnetLignes: string[] = [];
  let carnetAbsent = false;
  if (options.carnet) {
    try {
      carnetLignes = (await readFile(options.carnet, 'utf8')).split(/\r?\n/);
    } catch {
      carnetAbsent = true;
    }
  }

  const examens = await lireExamensDuTrieur(dir);
  const classe = classerConversations({
    conversations,
    carnet: carnetLignes,
    examens,
    validation: options.validation,
    seed: options.seed,
    sauteesFichiers,
    carnetAbsent,
    conversationsAbsentes: absentes,
  });

  if (options.ecrire !== false) {
    await mkdir(join(resolve(dir), 'conversations'), { recursive: true });
    await writeFile(fichiers.trieur, ecrireJsonl(classe.trieur), 'utf8');
    await writeFile(fichiers.reponses, ecrireJsonl(classe.reponses), 'utf8');
    await writeFile(fichiers.aCorriger, ecrireJsonl(classe.aCorriger), 'utf8');
    await writeFile(fichiers.ecartes, ecrireJsonl(classe.ecartes), 'utf8');
    await writeFile(fichiers.resume, `${JSON.stringify(classe.resume, null, 2)}\n`, 'utf8');
  }

  return { ...classe, fichiers };
}
