/**
 * Lecture seule des sources. Un fichier abîmé est sauté et compté.
 * Le texte lu ne sort pas de ce module : il est classé tout de suite
 * par l'appelant, ou réduit à une empreinte.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeHumanMessageText, claudeMessageBranch } from '../trieur/claudeExport.js';
import type { ClaudeExportMessage } from '../trieur/claudeExport.js';
import { classerDemande } from './families.js';
import {
  empreinteTexte,
  jetonSur,
  type ConversationLue,
  type Lieu,
  type LigneCarnet,
  type MessageLu,
  type OutilVu,
  type RouteLue,
  type StatutOutil,
} from './demandes.js';

export interface TexteClasse {
  id: string;
  at: number | null;
  texte: string;
}

export interface SessionTexte {
  id: string;
  messages: TexteClasse[];
}

const TYPES_CARNET = new Set([
  'correction',
  'repetition',
  'interruption',
  'outil_echec',
  'lenteur',
  'chemin',
  'signale',
]);

const CODES_REUSSI = new Set(['ok', 'success', 'reussi', 'réussi']);
const CODES_REFUSE = new Set(['denied', 'refus', 'refuse', 'refusé', 'cancelled', 'canceled']);
const CODES_RATE = new Set([
  'error',
  'erreur',
  'definitive',
  'timeout',
  'missing_dependency',
  'recoverable',
  'verification_failed',
]);

export function identifiantSur(value: unknown, repli: string): string {
  if (typeof value !== 'string') return repli;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 80) return repli;
  return trimmed;
}

export function lieuConnu(row: Record<string, unknown>, title: string): Lieu | null {
  const brut = row.lieu ?? row.place;
  const kind =
    typeof brut === 'string' ? brut : brut && typeof brut === 'object' ? (brut as { kind?: unknown }).kind : null;
  if (kind === 'fenetre' || kind === 'telephone' || kind === 'enceinte') return kind;
  if (/^[^·\n]{1,40} · /.test(title)) return 'enceinte';
  return null;
}

export function parseConversation(raw: unknown, repliId: string): ConversationLue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.messages)) return null;
  const title = typeof row.title === 'string' ? row.title : '';
  const messages: MessageLu[] = [];
  row.messages.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const message = item as Record<string, unknown>;
    const mission = message.chatMission;
    const kind =
      mission && typeof mission === 'object' && typeof (mission as { kind?: unknown }).kind === 'string'
        ? (mission as { kind: string }).kind
        : null;
    messages.push({
      id: identifiantSur(message.id, `m${index}`),
      role: typeof message.role === 'string' ? message.role : '',
      content: typeof message.content === 'string' ? message.content : '',
      createdAt: typeof message.createdAt === 'number' && Number.isFinite(message.createdAt) ? message.createdAt : null,
      toolName: typeof message.toolName === 'string' ? message.toolName : null,
      toolStatus: typeof message.toolStatus === 'string' ? message.toolStatus : null,
      missionId: typeof message.missionId === 'string' && message.missionId.trim() ? message.missionId : null,
      chatMissionKind: kind,
    });
  });
  const routeLog: RouteLue[] = [];
  if (Array.isArray(row.routeLog)) {
    for (const item of row.routeLog) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const userMessageId = identifiantSur(entry.userMessageId, '');
      if (!userMessageId || userMessageId === '') continue;
      routeLog.push({
        userMessageId,
        team: typeof entry.team === 'string' ? entry.team : null,
        how: typeof entry.how === 'string' ? entry.how : null,
      });
    }
  }
  return {
    id: identifiantSur(row.id, repliId),
    lieu: lieuConnu(row, title),
    messages,
    routeLog,
  };
}

function statutResultat(result: string, type: string): StatutOutil | null {
  const code = result.trim().toLowerCase();
  if (CODES_REUSSI.has(code)) return 'reussi';
  if (CODES_REFUSE.has(code)) return 'refuse';
  if (CODES_RATE.has(code)) return 'rate';
  if (type === 'outil_echec') return 'rate';
  return null;
}

/** Une ligne de rates.jsonl. `null` si elle est illisible ou d'un type inconnu. */
export function parseLigneCarnet(raw: string, index: number): LigneCarnet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  if (row.version !== 1) return null;
  if (typeof row.type !== 'string' || !TYPES_CARNET.has(row.type)) return null;
  if (typeof row.userText !== 'string' || !row.userText.trim()) return null;
  const classement = classerDemande(row.userText);
  const outils: OutilVu[] = [];
  if (Array.isArray(row.tools)) {
    for (const item of row.tools) {
      if (!item || typeof item !== 'object') continue;
      const tool = item as Record<string, unknown>;
      const nom = typeof tool.name === 'string' ? tool.name.trim() : '';
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(nom)) continue;
      const result = typeof tool.result === 'string' ? tool.result : '';
      const statut = statutResultat(result, row.type);
      if (!statut) continue;
      outils.push({ nom, statut });
    }
  }
  const source = row.source;
  let lieu: Lieu | null = null;
  if (source && typeof source === 'object') {
    const kind = (source as { kind?: unknown }).kind;
    if (kind === 'fenetre' || kind === 'telephone' || kind === 'enceinte') lieu = kind;
  }
  const at = typeof row.date === 'string' ? Date.parse(row.date) : Number.NaN;
  return {
    id: identifiantSur(row.id, `carnet-${index}`),
    at: Number.isFinite(at) ? at : null,
    conversationId: identifiantSur(row.conversationId, 'carnet'),
    empreinte: empreinteTexte(row.userText),
    famille: classement.famille,
    langage: classement.langage,
    equipe: jetonSur(typeof row.team === 'string' ? row.team : null),
    facon: jetonSur(typeof row.how === 'string' ? row.how : null),
    lieu,
    outils,
  };
}

export function messagesClaudeExport(raw: unknown): SessionTexte[] {
  if (!Array.isArray(raw)) return [];
  const sessions: SessionTexte[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const row = item as Record<string, unknown>;
    const chat = Array.isArray(row.chat_messages) ? row.chat_messages : [];
    const messages: ClaudeExportMessage[] = [];
    chat.forEach((entry, messageIndex) => {
      if (!entry || typeof entry !== 'object') return;
      const message = entry as ClaudeExportMessage;
      const uuid = identifiantSur(message.uuid, `m${messageIndex}`);
      messages.push({ ...message, uuid });
    });
    const leaf = typeof row.current_leaf_message_uuid === 'string' ? row.current_leaf_message_uuid : undefined;
    const gardes: TexteClasse[] = [];
    for (const message of claudeMessageBranch(messages, leaf)) {
      const texte = claudeHumanMessageText(message);
      if (!texte.trim()) continue;
      const at = message.created_at ? Date.parse(message.created_at) : Number.NaN;
      gardes.push({
        id: identifiantSur(message.uuid, `m${gardes.length}`),
        at: Number.isFinite(at) ? at : null,
        texte,
      });
    }
    sessions.push({ id: identifiantSur(row.uuid, `claude-${index}`), messages: gardes });
  });
  return sessions;
}

const DEBUTS_ECARTES = [
  '<system-reminder>',
  '<command-name>',
  '<command-message>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<task-notification>',
  'Caveat: The messages below were generated by the user while running local commands',
] as const;

const REPRISE = 'This session is being continued from a previous conversation';

export type LigneClaudeCode =
  | { issue: 'demande'; texte: string; id: string; at: number | null; sessionId: string | null }
  | { issue: 'ecarte' }
  | { issue: 'interruption' };

function texteEcarte(texte: string): boolean {
  const brut = texte.trimStart();
  if (brut.startsWith(REPRISE)) return true;
  return DEBUTS_ECARTES.some((debut) => brut.startsWith(debut));
}

function texteInterrompu(texte: string): boolean {
  const brut = texte.trim();
  return (
    brut.startsWith('[Request interrupted by user]') ||
    brut.startsWith('[Request interrupted by user for tool use]')
  );
}

/** Retire les blocs ajoutés au milieu d'un message réellement tapé. */
export function retirerRappelsSysteme(texte: string): string {
  return texte.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/**
 * Message tapé dans une session Claude Code.
 * Les lignes écrites par Claude ou par l'outil sont écartées.
 * Une interruption n'est pas une demande.
 * `null` : ce n'est pas une ligne utilisateur (assistant, outil, résumé, méta).
 */
export function texteClaudeCode(record: unknown): LigneClaudeCode | null {
  if (!record || typeof record !== 'object') return null;
  const row = record as Record<string, unknown>;
  if (row.isSidechain === true || row.isCompactSummary === true) return { issue: 'ecarte' };
  if (row.type !== 'user' || row.isMeta === true) return null;
  const message = row.message;
  if (!message || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  const bouts: string[] = [];
  if (typeof content === 'string') bouts.push(content);
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const item = block as { type?: unknown; text?: unknown };
      if (item.type === 'tool_result' || item.type === 'tool_use') continue;
      if ((item.type === 'text' || item.type === undefined) && typeof item.text === 'string') bouts.push(item.text);
    }
  }
  const brut = bouts.join('\n').trim();
  if (!brut) return null;
  if (texteEcarte(brut)) return { issue: 'ecarte' };
  if (texteInterrompu(brut)) return { issue: 'interruption' };
  const texte = retirerRappelsSysteme(brut);
  if (!texte) return { issue: 'ecarte' };
  if (texteEcarte(texte)) return { issue: 'ecarte' };
  if (texteInterrompu(texte)) return { issue: 'interruption' };
  const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN;
  return {
    issue: 'demande',
    texte,
    id: identifiantSur(row.uuid, ''),
    at: Number.isFinite(at) ? at : null,
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : null,
  };
}

function fichierSousAgents(relatif: string): boolean {
  return relatif.split(/[/\\]/).includes('subagents');
}

export async function lireDossierConversations(dir: string): Promise<{
  conversations: ConversationLue[];
  sautees: number;
  absente: boolean;
}> {
  let names: string[];
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return { conversations: [], sautees: 1, absente: false };
    names = await readdir(dir);
  } catch {
    return { conversations: [], sautees: 0, absente: true };
  }
  const conversations: ConversationLue[] = [];
  let sautees = 0;
  let index = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    index += 1;
    try {
      const parsed = parseConversation(JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown, `c${index}`);
      if (!parsed) {
        sautees += 1;
        continue;
      }
      conversations.push(parsed);
    } catch {
      sautees += 1;
    }
  }
  return { conversations, sautees, absente: false };
}

export async function lireFichierCarnet(path: string): Promise<{
  lignes: LigneCarnet[];
  ignorees: number;
  absente: boolean;
}> {
  let raw: string;
  try {
    const info = await stat(path);
    if (!info.isFile()) return { lignes: [], ignorees: 1, absente: false };
    raw = await readFile(path, 'utf8');
  } catch {
    return { lignes: [], ignorees: 0, absente: true };
  }
  const lignes: LigneCarnet[] = [];
  let ignorees = 0;
  raw.split(/\r?\n/).forEach((row, index) => {
    if (!row.trim()) return;
    const parsed = parseLigneCarnet(row, index + 1);
    if (!parsed) {
      ignorees += 1;
      return;
    }
    lignes.push(parsed);
  });
  return { lignes, ignorees, absente: false };
}

async function conversationsJsonDans(dir: string): Promise<string> {
  try {
    return await readFile(join(dir, 'conversations.json'), 'utf8');
  } catch {
    const entries = await readdir(dir);
    for (const name of entries) {
      try {
        const info = await stat(join(dir, name));
        if (!info.isDirectory()) continue;
        return await readFile(join(dir, name, 'conversations.json'), 'utf8');
      } catch {
        // autre dossier
      }
    }
  }
  throw new Error('illisible');
}

async function lireZip(zipPath: string): Promise<string> {
  const fromUnzip = spawnSync('unzip', ['-p', zipPath, 'conversations.json'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (fromUnzip.status === 0 && fromUnzip.stdout) return fromUnzip.stdout;
  const tempDir = await mkdtemp(join(tmpdir(), 'jarvis-carte-'));
  try {
    const tar = spawnSync('tar', ['-xf', zipPath, '-C', tempDir], { encoding: 'utf8' });
    if (tar.status !== 0) throw new Error('illisible');
    return await conversationsJsonDans(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function lireExportClaude(path: string): Promise<{
  sessions: SessionTexte[];
  saute: boolean;
  absente: boolean;
}> {
  try {
    const info = await stat(path);
    const raw = info.isDirectory()
      ? await conversationsJsonDans(path)
      : path.toLowerCase().endsWith('.zip')
        ? await lireZip(path)
        : await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { sessions: [], saute: true, absente: false };
    return { sessions: messagesClaudeExport(parsed), saute: false, absente: false };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return { sessions: [], saute: false, absente: true };
    return { sessions: [], saute: true, absente: false };
  }
}

async function listerJsonl(dir: string, profondeur = 0): Promise<string[]> {
  if (profondeur > 6) return [];
  const names = await readdir(dir);
  const fichiers: string[] = [];
  for (const name of names) {
    const chemin = join(dir, name);
    let info: { isDirectory(): boolean };
    try {
      info = await stat(chemin);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      const sous = await listerJsonl(chemin, profondeur + 1);
      for (const fichier of sous) fichiers.push(join(name, fichier));
    } else if (name.toLowerCase().endsWith('.jsonl')) fichiers.push(name);
  }
  return fichiers;
}

export async function lireClaudeCode(dir: string): Promise<{
  sessions: SessionTexte[];
  fichiers: number;
  ignorees: number;
  ecartees: number;
  interruptions: number;
  absente: boolean;
}> {
  let fichiers: string[];
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return { sessions: [], fichiers: 0, ignorees: 1, ecartees: 0, interruptions: 0, absente: false };
    fichiers = await listerJsonl(dir);
  } catch {
    return { sessions: [], fichiers: 0, ignorees: 0, ecartees: 0, interruptions: 0, absente: true };
  }
  const sessions: SessionTexte[] = [];
  let ignorees = 0;
  let ecartees = 0;
  let interruptions = 0;
  let indexFichier = 0;
  for (const relatif of fichiers) {
    indexFichier += 1;
    let raw: string;
    try {
      raw = await readFile(join(dir, relatif), 'utf8');
    } catch {
      ignorees += 1;
      continue;
    }
    const messages: TexteClasse[] = [];
    let sessionId = '';
    const sousAgent = fichierSousAgents(relatif);
    const rows = raw.split(/\r?\n/);
    rows.forEach((row, index) => {
      if (!row.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row) as unknown;
      } catch {
        ignorees += 1;
        return;
      }
      const ligne = texteClaudeCode(parsed);
      if (!ligne) return;
      if (sousAgent || ligne.issue === 'ecarte') {
        ecartees += 1;
        return;
      }
      if (ligne.issue === 'interruption') {
        interruptions += 1;
        return;
      }
      if (!sessionId && ligne.sessionId) sessionId = identifiantSur(ligne.sessionId, '');
      messages.push({
        id: ligne.id || `l${index + 1}`,
        at: ligne.at,
        texte: ligne.texte,
      });
    });
    if (sousAgent) continue;
    sessions.push({
      id: sessionId || `session-${indexFichier}`,
      messages,
    });
  }
  return { sessions, fichiers: fichiers.length, ignorees, ecartees, interruptions, absente: false };
}
