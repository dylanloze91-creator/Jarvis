/**
 * Notes et liste. Règles seulement : quantité, unité et jour quand ils sont dits.
 * Le fichier sur le disque est dans `fichiers.ts`, hors de l'index du cœur.
 */
import { redactSecrets } from '../security/redact.js';

export interface NoteItem {
  id: string;
  /** Texte gardé, sans la quantité ni le jour quand ils ont été relevés. */
  text: string;
  quantity: number | null;
  unit: string | null;
  /** Jour dit (« lundi », « demain »), tel que plié. */
  day: string | null;
  done: boolean;
  at: number;
}

export type NotePlace = 'fenetre' | 'telephone' | 'enceinte';

export type NoteIntent =
  | { kind: 'add'; body: string }
  | { kind: 'list' }
  | { kind: 'check'; query: string }
  | { kind: 'erase'; query: string };

const DAY_PATTERN = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|aujourd['’]hui|demain";
const UNITS = new Set([
  'paquet',
  'paquets',
  'sac',
  'sacs',
  'boite',
  'boites',
  'rouleau',
  'rouleaux',
  'kg',
  'g',
  'm',
  'metre',
  'metres',
  'litre',
  'litres',
  'l',
  'unite',
  'unites',
]);

export function foldNote(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripWake(text: string): string {
  return text
    .trim()
    .replace(/^(?:jarvis)[,.\s]+/iu, '')
    .replace(/[,.\s]+(?:jarvis)\s*$/iu, '')
    .trim();
}

/** « ma liste », « ma liste de courses », « mes notes ». */
const LIST_OBJECT = '(?:ma liste(?: de courses)?|mes notes)';
const LIST_PLACE = `(?:sur|dans) ${LIST_OBJECT}`;

/**
 * Façons de demander à relire la liste, sur le texte plié (sans accent ni ponctuation). La phrase
 * entière doit être la demande : « ajoute à ma liste du pain » ou « mets ma liste de lecture » n'en
 * sont pas. Essai A4 du 18 novembre : « Qu'est-ce qu'il y a sur ma liste ? » partait à une équipe
 * qui n'a pas la liste.
 */
const LIST_REQUESTS = [
  `^${LIST_OBJECT}$`,
  `^(?:relis|lis|montre|affiche|donne|dis|rappelle)(?: moi)? ${LIST_OBJECT}$`,
  `^(?:peux tu |tu peux |est ce que tu peux )?(?:me )?(?:relire|lire|montrer|afficher|donner|dire|rappeler) ${LIST_OBJECT}$`,
  `^qu est ce qu il y a ${LIST_PLACE}$`,
  `^qu y a t il ${LIST_PLACE}$`,
  `^(?:il y a|y a|j ai|on a) quoi ${LIST_PLACE}$`,
  `^qu est ce que j ai ${LIST_PLACE}$`,
  `^(?:dis moi |montre moi |rappelle moi )?ce qu il y a ${LIST_PLACE}$`,
  `^(?:c est quoi|quelle est) ${LIST_OBJECT}$`,
  '^quelles sont mes notes$',
  '^qu est ce que j ai note$',
  '^qu est ce que tu as note$',
  '^(?:j ai|tu as) note quoi$',
].map((pattern) => new RegExp(pattern, 'u'));

function isListRequest(folded: string): boolean {
  const request = folded.replace(/ (?:s il te plait|s il vous plait|stp|svp)$/u, '');
  return LIST_REQUESTS.some((pattern) => pattern.test(request));
}

/**
 * Une liste qui n'est pas la liste de Jarvis : une liste de lecture (Spotify), de diffusion…
 * Sur le texte plié.
 */
const OTHER_LIST = /\b(?:liste de lecture|liste de diffusion|liste noire|liste blanche|playlist)\b/u;

/** « ma liste », « ma liste de courses », « mes notes », sur le texte brut. */
const RAW_LIST = String.raw`(?:ma\s+liste(?:\s+de\s+courses)?|mes\s+notes)`;
const RAW_ADD_VERB = String.raw`(?:note|notes|ajoute|rajoute|mets|met|inscris|[ée]cris|marque)`;
const RAW_PLACE = String.raw`(?:dans|sur|à|a|au)`;
const POLITE_END = /\s*(?:,\s*)?(?:s['’]il\s+te\s+pla[iî]t|s['’]il\s+vous\s+pla[iî]t|stp|svp)\s*$/iu;

/**
 * 23 novembre 2026 : « Note dans ma liste de … », « mets … sur ma liste », « ajoute … à ma liste »
 * partaient au cerveau, puis à une équipe qui n'a pas la liste et répondait « Bien noté » sans rien
 * noter. Avec le chef d'orchestre, aucune équipe n'a les outils des notes : ces phrases doivent être
 * prises ici, sans modèle.
 */
const ADD_LIST_FIRST = new RegExp(String.raw`^${RAW_ADD_VERB}\s+${RAW_PLACE}\s+${RAW_LIST}\s*[:,]?\s+(.+)$`, 'iu');
const ADD_LIST_LAST = new RegExp(String.raw`^${RAW_ADD_VERB}\s+(.+?)\s+${RAW_PLACE}\s+${RAW_LIST}\s*[.!?]?$`, 'iu');

const MUSIC_BODY = /^(?:ce|cette|le|la) (?:morceau|chanson|titre|album|son)\b/u;

/** Ce qui reste devant le contenu : « de nettoyer… » → « nettoyer… », « que je dois… » → « je dois… ». */
function cleanNoteBody(body: string): string {
  return body
    .replace(POLITE_END, '')
    .replace(/[?.!]+$/u, '')
    .trim()
    .replace(/^(?:que\s+|qu['’]\s*)/iu, '')
    .replace(/^(?:de\s+|d['’]\s*)(?!(?:la|l['’])\b)/iu, '')
    .trim();
}

/**
 * La phrase parle d'écrire dans la liste ou les notes de Jarvis, même si `noteIntent` n'a pas su
 * en tirer le contenu. Sert de garde : une telle phrase ne part jamais à une équipe qui n'a pas la
 * liste (elle répondrait « Bien noté » sans rien noter).
 */
export function looksLikeNoteRequest(text: string): boolean {
  const folded = foldNote(stripWake(text));
  if (!folded || OTHER_LIST.test(folded)) return false;
  if (!/\b(?:ma liste|la liste|mes notes|pense bete)\b/u.test(folded)) return false;
  return /\b(?:note|noter|notes|ajoute|ajouter|rajoute|rajouter|mets|mettre|met|inscris|inscrire|ecris|ecrire|marque|marquer)\b/u.test(
    folded,
  );
}

/** Demande de note alors que la liste est coupée : rien n'est noté, et c'est dit. */
export const NOTES_OFF_REPLY =
  "Je n'ai rien noté : la liste n'est pas activée. Tu peux l'activer dans Réglages, Moi, Notes.";
/** Demande de note dont `noteIntent` n'a pas su tirer le contenu. */
export const NOTE_UNCLEAR_REPLY =
  "Je n'ai rien noté : je n'ai pas compris quoi écrire. Dis par exemple « ajoute du pain à ma liste ».";
/** Ajouté sous une réponse qui dit « c'est noté » alors qu'aucun outil n'a rien écrit. */
export const NOTE_CLAIM_CORRECTION =
  "Correction : je n'ai rien noté, aucun outil n'a rien écrit pendant ce tour. Pour ta liste, dis par exemple « ajoute du pain à ma liste ».";

/**
 * La réponse affirme avoir noté ou ajouté quelque chose à une liste (« Bien noté », « C'est noté »,
 * « je l'ai ajouté à ta liste »). Sur le texte plié. Sert seulement quand aucun outil n'a réussi
 * pendant le tour : la phrase est alors fausse.
 */
export function claimsSomethingNoted(reply: string): boolean {
  const folded = foldNote(reply);
  if (!folded) return false;
  if (/\b(?:c est|bien|j ai|je l ai|je les ai|c est bien|tout est) notee?s?\b/u.test(folded)) return true;
  if (/^notee?s?\b/u.test(folded)) return true;
  return /\b(?:ajoutee?s?|notee?s?|inscrite?s?|mise?s?) (?:a|dans|sur) (?:ta|votre|la|tes|vos) (?:liste|notes)\b/u.test(folded);
}

/** Phrase express, ou null si le tour doit suivre vers le modèle. */
export function noteIntent(text: string): NoteIntent | null {
  const raw = stripWake(text);
  const folded = foldNote(raw);
  if (!folded) return null;
  if (OTHER_LIST.test(folded)) return null;
  if (isListRequest(folded)) return { kind: 'list' };
  if (folded.startsWith('c est bon pour ')) {
    const query = raw.replace(/^c['’]est bon pour\s+/iu, '').replace(/[?.!]+$/u, '').trim();
    return query ? { kind: 'check', query } : null;
  }
  const erase = raw.match(/^(?:efface|supprime|enleve)\s+(?:la\s+note|de ma liste)\s+(.+)$/iu);
  if (erase?.[1]) return { kind: 'erase', query: erase[1].replace(/[?.!]+$/u, '').trim() };
  for (const pattern of [ADD_LIST_FIRST, ADD_LIST_LAST]) {
    const found = raw.match(pattern)?.[1];
    const body = found ? cleanNoteBody(found) : '';
    // « Ajoute ce morceau à ma liste » parle de Spotify, pas de la liste de Jarvis.
    if (body && !MUSIC_BODY.test(foldNote(body))) return { kind: 'add', body };
  }
  const add = raw.match(/^(?:note\s*:\s*|rajoute à ma liste\s+|rajoute a ma liste\s+|ajoute à ma liste\s+)(.+)$/iu);
  if (add?.[1]?.trim()) return { kind: 'add', body: add[1].trim().replace(/[?.!]+$/u, '') };
  return null;
}

export function parseNoteBody(body: string): Pick<NoteItem, 'text' | 'quantity' | 'unit' | 'day'> {
  let rest = body.trim();
  let day: string | null = null;
  const dayRe = new RegExp(`\\bpour\\s+(${DAY_PATTERN})\\s*$`, 'iu');
  const dayMatch = rest.match(dayRe);
  if (dayMatch?.index !== undefined && dayMatch[1]) {
    day = foldNote(dayMatch[1]);
    rest = rest.slice(0, dayMatch.index).trim();
  }
  let quantity: number | null = null;
  let unit: string | null = null;
  const qty = rest.match(/^(\d+(?:[.,]\d+)?)\s+([A-Za-zÀ-ÿ-]+)\b\s*(?:de\s+|d['’])/u);
  if (qty?.[1] && qty[2] && UNITS.has(foldNote(qty[2]))) {
    quantity = Number(qty[1].replace(',', '.'));
    unit = foldNote(qty[2]);
    rest = rest.slice(qty[0].length).trim();
  }
  return { text: redactSecrets(rest || body.trim()), quantity, unit, day };
}

function queryWords(query: string): string {
  return foldNote(query).replace(/^(les|des|la|le|l|du|de)\s+/, '');
}

export function noteMatches(note: NoteItem, query: string): boolean {
  const needle = queryWords(query);
  if (!needle) return false;
  const hay = foldNote(`${note.quantity ?? ''} ${note.unit ?? ''} ${note.text}`);
  return hay.includes(needle);
}

export function formatNote(note: NoteItem): string {
  const qty = note.quantity !== null && note.unit ? `${note.quantity} ${note.unit} de ` : '';
  const when = note.day ? `, pour ${note.day}` : '';
  return `${qty}${note.text}${when}`;
}
