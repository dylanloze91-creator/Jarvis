/**
 * Boucle d'amélioration — lecture des tours.
 *
 * Idée reprise d'OpenJarvis (Stanford, Apache 2.0) : un « analyseur de traces » qui relit ce qui
 * s'est passé sur la machine pour décider quoi améliorer. Ici, les traces sont celles que Jarvis
 * écrit déjà : le journal du tour (`turnLog`, Jarvis Test), le journal des équipes (`routeLog`)
 * et le carnet des ratés (`rates.jsonl`). Aucun modèle, aucun réseau, rien n'est écrit ici.
 *
 * Les phrases de l'utilisateur restent dans la mémoire du programme et dans les fichiers de
 * sortie du dossier de données (jamais dans le dépôt).
 */
import type { TurnLogEntry, TurnSteps } from '../types.js';

export interface OutilDuTour {
  name: string;
  ok: boolean;
}

/** Un tour tel que la boucle d'amélioration le voit. */
export interface TourObserve {
  conversationId: string;
  userMessageId: string;
  /** Phrase de l'utilisateur. Locale seulement. */
  texte: string;
  /** Équipe du chef d'orchestre. `null` : chat d'avant, ou inconnue. */
  equipe: string | null;
  /** calcul, horloge, express, trieur, cerveau… `null` si inconnu. */
  chemin: string | null;
  modele: string | null;
  source: string | null;
  outils: OutilDuTour[];
  dureeMs: number | null;
  premierMotMs: number | null;
  /** Temps passé à choisir l'équipe. */
  triMs: number | null;
  /** Vrai si un modèle a été appelé pour trier (cerveau ou trieur). */
  triParModele: boolean;
  etapes: TurnSteps | null;
  /** Vrai si le journal du tour existe (Jarvis Test). */
  journal: boolean;
  /** Types de ratés notés par le carnet pour ce tour. Vide : aucun raté noté. */
  rates: string[];
  /** Catégorie choisie par l'utilisateur dans la revue du carnet, si elle existe. */
  categorie: string | null;
  at: number;
}

/** Chemins où aucun modèle n'a trié la demande. */
const CHEMINS_SANS_TRI = new Set(['calcul', 'horloge', 'express', 'mission-directe', 'direct', 'sante', 'quotidien']);
/** Chemins où un modèle a trié la demande. */
const CHEMINS_TRI_MODELE = new Set(['cerveau', 'trieur']);

function texteDe(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nombreDe(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Minuscules, sans accent, ponctuation en espaces : la même forme que les règles express. */
export function plier(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function triDu(journal: TurnLogEntry | null, chemin: string | null): { ms: number | null; modele: boolean } {
  const tri = journal?.etapes?.tri;
  if (tri) {
    const modele = tri.modele === true || CHEMINS_TRI_MODELE.has(tri.chemin);
    return { ms: nombreDe(tri.ms), modele };
  }
  if (chemin && CHEMINS_TRI_MODELE.has(chemin)) return { ms: null, modele: true };
  return { ms: null, modele: false };
}

function outilsDu(journal: TurnLogEntry | null, messages: readonly Record<string, unknown>[]): OutilDuTour[] {
  if (journal && Array.isArray(journal.tools)) {
    return journal.tools
      .filter((tool) => tool && typeof tool.name === 'string' && tool.name)
      .map((tool) => ({ name: tool.name, ok: tool.status === 'ok' || tool.status === 'success' }));
  }
  const outils: OutilDuTour[] = [];
  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.toolName !== 'string' || !message.toolName) continue;
    outils.push({ name: message.toolName, ok: message.toolStatus === 'ok' || message.toolStatus === 'success' });
  }
  return outils;
}

/**
 * Les tours d'une conversation enregistrée par Jarvis (le JSON d'un fichier de `conversations/`).
 * Une conversation illisible rend une liste vide. Les conversations marquées `synthetique-test`
 * sont prises comme les autres : c'est aux essais de choisir leurs données.
 */
export function toursDeConversation(raw: unknown): TourObserve[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.messages)) return [];
  const id = texteDe(row.id) ?? 'conversation';
  const messages = row.messages.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');

  const journaux = new Map<string, TurnLogEntry>();
  if (Array.isArray(row.turnLog)) {
    for (const item of row.turnLog) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as TurnLogEntry;
      if (typeof entry.userMessageId === 'string' && entry.userMessageId) journaux.set(entry.userMessageId, entry);
    }
  }
  const routes = new Map<string, { team: string | null; how: string | null; model: string | null }>();
  if (Array.isArray(row.routeLog)) {
    for (const item of row.routeLog) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const userMessageId = texteDe(entry.userMessageId);
      if (!userMessageId) continue;
      routes.set(userMessageId, { team: texteDe(entry.team), how: texteDe(entry.how), model: texteDe(entry.model) });
    }
  }

  const indexUtilisateur = messages
    .map((message, index) => ({ message, index }))
    .filter((item) => item.message.role === 'user' && typeof item.message.content === 'string' && item.message.content.trim());

  return indexUtilisateur.map((item, ordre) => {
    const fin = indexUtilisateur[ordre + 1]?.index ?? messages.length;
    const userMessageId = texteDe(item.message.id) ?? `m${item.index}`;
    const journal = journaux.get(userMessageId) ?? null;
    const route = routes.get(userMessageId) ?? null;
    const chemin = journal?.how ?? route?.how ?? null;
    const tri = triDu(journal, chemin);
    const etapes = journal?.etapes ?? null;
    return {
      conversationId: id,
      userMessageId,
      texte: item.message.content as string,
      equipe: journal?.team ?? route?.team ?? null,
      chemin,
      modele: journal?.model ?? route?.model ?? null,
      source: journal?.source ?? null,
      outils: outilsDu(journal, messages.slice(item.index + 1, fin)),
      dureeMs: nombreDe(journal?.durationMs),
      premierMotMs: nombreDe(etapes?.premierMot),
      triMs: tri.ms,
      triParModele: tri.modele && !(chemin !== null && CHEMINS_SANS_TRI.has(chemin)),
      etapes,
      journal: journal !== null,
      rates: [],
      categorie: null,
      at: nombreDe(journal?.at) ?? (nombreDe(item.message.createdAt) ?? 0),
    };
  });
}

/** Une ligne du carnet des ratés, réduite à ce que la boucle lit. */
export interface RateLu {
  conversationId: string;
  userText: string;
  type: string;
  category: string | null;
}

/** Une ligne de `rates.jsonl`. `null` si elle est illisible. */
export function lireLigneCarnet(line: string): RateLu | null {
  if (!line.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  const conversationId = texteDe(row.conversationId);
  const userText = texteDe(row.userText);
  const type = texteDe(row.type);
  if (!conversationId || !userText || !type) return null;
  return { conversationId, userText, type, category: texteDe(row.category) };
}

/**
 * Rattache chaque raté du carnet à son tour (même conversation, même phrase). Une entrée classée
 * « pas grave » par l'utilisateur n'est pas un raté. Rend le nombre d'entrées rattachées.
 */
export function rattacherRates(tours: TourObserve[], rates: readonly RateLu[]): { rattaches: number; orphelins: number } {
  const parCle = new Map<string, TourObserve[]>();
  for (const tour of tours) {
    const cle = `${tour.conversationId}\u0000${plier(tour.texte)}`;
    const liste = parCle.get(cle) ?? [];
    liste.push(tour);
    parCle.set(cle, liste);
  }
  let rattaches = 0;
  let orphelins = 0;
  for (const rate of rates) {
    if (rate.category === 'pas-grave') continue;
    const liste = parCle.get(`${rate.conversationId}\u0000${plier(rate.userText)}`);
    if (!liste?.length) {
      orphelins += 1;
      continue;
    }
    // Même phrase dite plusieurs fois dans la discussion : le dernier tour sans ce raté.
    const tour = [...liste].reverse().find((item) => !item.rates.includes(rate.type)) ?? liste[liste.length - 1]!;
    if (!tour.rates.includes(rate.type)) tour.rates.push(rate.type);
    if (rate.category) tour.categorie = rate.category;
    rattaches += 1;
  }
  return { rattaches, orphelins };
}

/** Vrai si le tour a un raté noté. */
export function estRate(tour: TourObserve): boolean {
  return tour.rates.length > 0;
}
