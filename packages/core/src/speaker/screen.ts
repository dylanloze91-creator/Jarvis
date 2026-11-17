/**
 * Information affichée sur l'écran d'une enceinte : en-tête de réponse
 * `X-Jarvis-Ecran: titre|ligne|secondes`, lu par le programme de l'enceinte
 * (`display_info_parse`, `firmware/jarvis-speaker/src/display_view.c`).
 *
 * - UTF-8 encodé pour une URL ; `|` et `%` du titre et de la ligne sont donc encodés ;
 * - titre de 47 octets au plus, ligne de 95 au plus (tampons de 48 et 96 de la carte) ;
 * - 20 s par défaut, 300 s au plus ; `-` efface.
 *
 * Fonctions pures : rien n'est envoyé d'ici.
 */

export const SPEAKER_SCREEN_HEADER = 'X-Jarvis-Ecran';
export const SPEAKER_SCREEN_TITLE_MAX_BYTES = 47;
export const SPEAKER_SCREEN_LINE_MAX_BYTES = 95;
export const SPEAKER_SCREEN_DEFAULT_SECONDS = 20;
export const SPEAKER_SCREEN_MAX_SECONDS = 300;

export interface SpeakerScreenInfo {
  title: string;
  line?: string;
  /** Durée d'affichage. Absente ou invalide : 20 s. Bornée à 1–300 s. */
  seconds?: number;
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Texte sur une seule ligne, coupé à `maxBytes` octets UTF-8 sans casser un caractère.
 * Retours à la ligne, tabulations et autres caractères de contrôle deviennent une espace
 * (la carte refuse tout l'en-tête s'il en reste un).
 */
export function speakerScreenText(text: string, maxBytes: number): string {
  let clean = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    // Demi-paire isolée : illisible en UTF-8, retirée.
    if (code >= 0xd800 && code <= 0xdfff) continue;
    clean += code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ? ' ' : char;
  }
  clean = clean.replace(/\s+/g, ' ').trim();
  let out = '';
  let bytes = 0;
  for (const char of clean) {
    const size = utf8Length(char.codePointAt(0)!);
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out.trimEnd();
}

/** Durée d'affichage envoyée à la carte : 20 s par défaut, de 1 à 300 s. */
export function speakerScreenSeconds(seconds: number | undefined): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return SPEAKER_SCREEN_DEFAULT_SECONDS;
  return Math.min(SPEAKER_SCREEN_MAX_SECONDS, Math.max(1, Math.round(seconds)));
}

/**
 * Valeur de l'en-tête `X-Jarvis-Ecran`, toujours sous la forme `titre|ligne|secondes`.
 * `null` si le titre est vide une fois nettoyé : la carte refuserait l'en-tête.
 */
export function speakerScreenHeader(info: SpeakerScreenInfo): string | null {
  const title = speakerScreenText(info.title, SPEAKER_SCREEN_TITLE_MAX_BYTES);
  if (!title) return null;
  const line = speakerScreenText(info.line ?? '', SPEAKER_SCREEN_LINE_MAX_BYTES);
  return `${encodeURIComponent(title)}|${encodeURIComponent(line)}|${speakerScreenSeconds(info.seconds)}`;
}

/** Valeur de l'en-tête qui efface l'information affichée. */
export function speakerScreenClear(): string {
  return '-';
}

export type ParsedSpeakerScreen = { clear: true } | { clear: false; title: string; line: string; seconds: number };

const UTF8 = new TextEncoder();

function decodePart(part: string, size: number): string | null {
  const bytes: number[] = [];
  const raw = UTF8.encode(part);
  for (let i = 0; i < raw.length; i += 1) {
    let c = raw[i]!;
    if (c === 0x25) {
      const hex = String.fromCharCode(raw[i + 1] ?? 0, raw[i + 2] ?? 0);
      if (i + 2 >= raw.length || !/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      c = Number.parseInt(hex, 16);
      i += 2;
    } else if (c === 0x2b) {
      c = 0x20;
    }
    if (c < 0x20 || c === 0x7f) return null;
    if (bytes.length + 1 >= size) break;
    bytes.push(c);
  }
  // Ne pas couper une lettre accentuée en deux : une suite incomplète en fin de tampon est retirée,
  // une lettre entière est gardée (même règle que la carte).
  let n = bytes.length;
  let lead = n;
  while (lead > 0 && (bytes[lead - 1]! & 0xc0) === 0x80) lead -= 1;
  if (lead > 0 && (bytes[lead - 1]! & 0xc0) === 0xc0) {
    const first = bytes[lead - 1]!;
    const expected = first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : 2;
    if (n - (lead - 1) < expected) n = lead - 1;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes.slice(0, n)));
}

/**
 * Lecture de l'en-tête, **comme la carte** (`display_info_parse`, mêmes tampons de 48 et 96) :
 * sert aux tests et à la fausse enceinte. `null` : en-tête illisible, la carte ne change rien.
 */
export function parseSpeakerScreenHeader(header: string): ParsedSpeakerScreen | null {
  const value = header.replace(/^ +/, '');
  if (value === '' || value === '-') return { clear: true };
  const bar1 = value.indexOf('|');
  const title = decodePart(bar1 < 0 ? value : value.slice(0, bar1), SPEAKER_SCREEN_TITLE_MAX_BYTES + 1);
  if (!title) return null;
  let line = '';
  let seconds = SPEAKER_SCREEN_DEFAULT_SECONDS;
  if (bar1 >= 0) {
    const bar2 = value.indexOf('|', bar1 + 1);
    const decoded = decodePart(bar2 < 0 ? value.slice(bar1 + 1) : value.slice(bar1 + 1, bar2), SPEAKER_SCREEN_LINE_MAX_BYTES + 1);
    if (decoded === null) return null;
    line = decoded;
    if (bar2 >= 0) {
      const digits = value.slice(bar2 + 1);
      if (!/^[0-9]+$/.test(digits)) return null;
      seconds = Number(digits.slice(0, 7));
    }
  }
  if (seconds === 0) seconds = SPEAKER_SCREEN_DEFAULT_SECONDS;
  if (seconds > SPEAKER_SCREEN_MAX_SECONDS) seconds = SPEAKER_SCREEN_MAX_SECONDS;
  return { clear: false, title, line, seconds };
}

/** Nom de l'outil de discussion qui affiche une information sur l'écran d'une enceinte. */
export const SPEAKER_SCREEN_TOOL = 'afficher_sur_enceinte';

/**
 * « Affiche … sur l'enceinte », « écris … sur les enceintes » : une demande d'affichage sur
 * l'écran d'une enceinte, repérée par règle. « Mets … sur l'enceinte » reste de la musique.
 */
export function looksLikeSpeakerScreenIntent(text: string): boolean {
  const folded = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return /\b(?:affiche|ecris|montre|marque)[a-z-]*\b[^.?!]*\bsur\b[^.?!]*\benceintes?\b/.test(folded);
}

export interface SpeakerScreenRequest {
  titre: string;
  ligne?: string;
  /** Nom de l'enceinte dit dans la demande ; absent : toutes. */
  enceinte?: string;
}

const SCREEN_VERB = '(?:affiche|[ée]cris|montre|marque)(?:[- ]moi)?';
const SCREEN_WHERE = "sur\\s+(?:l['’]\\s?enceinte|(?:toutes\\s+)?les\\s+enceintes)";
const SCREEN_ROOM = "(?:\\s+(?:de\\s+la|du|de\\s+l['’]|des|de)\\s*([^:,.!?]+?))?";
const SCREEN_LEAD = "^\\s*(?:jarvis\\s*[,!]?\\s*)?(?:(?:peux|pourrais)[- ]tu\\s+|tu\\s+peux\\s+|s['’]il\\s+te\\s+pla[iî]t\\s*,?\\s*)?";

function unquote(text: string): string {
  return text.trim().replace(/^[«"“'‘\s]+|[»"”'’\s]+$/gu, '').trim();
}

function capitalized(text: string): string {
  return text ? text[0]!.toLocaleUpperCase('fr-FR') + text.slice(1) : text;
}

/**
 * Lit par règles une demande simple d'affichage : « Affiche Terminé sur l'enceinte de la chambre »,
 * « Affiche Dîner, à table ! sur l'enceinte », « Affiche sur l'enceinte : Test », « … le titre A et
 * la ligne B ». `null` : la phrase n'a pas cette forme, le modèle s'en occupe comme avant.
 *
 * Raison (essais du 17 novembre 2026) : le modèle répondait « affichage terminé » sans appeler
 * l'outil quand la phrase venait de la voix, et oubliait le titre une fois sur trois.
 */
export function parseSpeakerScreenRequest(text: string): SpeakerScreenRequest | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  let content = '';
  let room = '';
  const after = new RegExp(`${SCREEN_LEAD}${SCREEN_VERB}\\s+${SCREEN_WHERE}${SCREEN_ROOM}\\s*[:,]\\s*(.+)$`, 'iu').exec(clean);
  const before = new RegExp(`${SCREEN_LEAD}${SCREEN_VERB}\\s+(.+?)\\s+${SCREEN_WHERE}${SCREEN_ROOM}\\s*[.!?]*$`, 'iu').exec(clean);
  if (after) {
    room = after[1] ?? '';
    content = after[2] ?? '';
  } else if (before) {
    content = before[1] ?? '';
    room = before[2] ?? '';
  } else {
    const middle = new RegExp(`${SCREEN_LEAD}${SCREEN_VERB}\\s+${SCREEN_WHERE}${SCREEN_ROOM}\\s+(le\\s+titre\\s+.+)$`, 'iu').exec(clean);
    if (!middle) return null;
    room = middle[1] ?? '';
    content = middle[2] ?? '';
  }
  content = unquote(content.replace(/[.\s]+$/u, ''));
  if (!content) return null;
  let titre = content;
  let ligne = '';
  const named = /^(?:le\s+)?titre\s+(.+?)\s*(?:,|\bet\b|\bavec\b)\s*(?:la\s+)?ligne\s+(.+)$/iu.exec(content);
  const comma = /^([^,:]{1,40})\s*[,:]\s+(.+)$/u.exec(content);
  if (named) {
    titre = unquote(named[1]!);
    ligne = unquote(named[2]!);
  } else if (comma) {
    titre = unquote(comma[1]!);
    ligne = unquote(comma[2]!);
  } else {
    const head = speakerScreenText(content, SPEAKER_SCREEN_TITLE_MAX_BYTES);
    if (head !== content) {
      // Trop long pour le titre : coupé à un mot, la suite passe sur la ligne.
      const cut = head.lastIndexOf(' ');
      titre = cut > 0 ? head.slice(0, cut) : head;
      ligne = content.slice(titre.length).trim();
    }
  }
  titre = capitalized(titre.replace(/^(?:le\s+(?:mot|texte|message)\s+)/iu, ''));
  if (!titre) return null;
  const enceinte = unquote(room);
  return { titre, ...(ligne ? { ligne } : {}), ...(enceinte ? { enceinte } : {}) };
}
