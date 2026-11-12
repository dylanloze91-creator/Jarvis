/**
 * Notes et liste. Règles seulement : quantité, unité et jour quand ils sont dits.
 * Le fichier est local (`userData/notes.json`), jamais dans le dépôt.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

/** Phrase express, ou null si le tour doit suivre vers le modèle. */
export function noteIntent(text: string): NoteIntent | null {
  const raw = stripWake(text);
  const folded = foldNote(raw);
  if (!folded) return null;
  if (folded === 'qu est ce que j ai note' || folded === 'mes notes' || folded === 'ma liste') return { kind: 'list' };
  if (folded.startsWith('c est bon pour ')) {
    const query = raw.replace(/^c['’]est bon pour\s+/iu, '').replace(/[?.!]+$/u, '').trim();
    return query ? { kind: 'check', query } : null;
  }
  const erase = raw.match(/^(?:efface|supprime|enleve)\s+(?:la\s+note|de ma liste)\s+(.+)$/iu);
  if (erase?.[1]) return { kind: 'erase', query: erase[1].replace(/[?.!]+$/u, '').trim() };
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

interface NotesFile {
  version: 1;
  items: NoteItem[];
}

export class NotesBook {
  constructor(private readonly pathOf: () => string) {}

  private file(): string {
    return this.pathOf();
  }

  async list(): Promise<NoteItem[]> {
    return (await this.read()).items;
  }

  async pendingLabels(): Promise<string[]> {
    return (await this.list()).filter((note) => !note.done).map(formatNote);
  }

  async add(body: string, now = Date.now()): Promise<NoteItem> {
    const parsed = parseNoteBody(body);
    const file = await this.read();
    const note: NoteItem = { id: `n-${now.toString(36)}-${file.items.length}`, ...parsed, done: false, at: now };
    file.items.push(note);
    await this.write(file);
    return note;
  }

  async check(query: string): Promise<NoteItem | null> {
    const file = await this.read();
    const note = file.items.find((item) => !item.done && noteMatches(item, query));
    if (!note) return null;
    note.done = true;
    await this.write(file);
    return note;
  }

  async erase(query: string): Promise<NoteItem | null> {
    const file = await this.read();
    const index = file.items.findIndex((item) => noteMatches(item, query));
    if (index < 0) return null;
    const [note] = file.items.splice(index, 1);
    await this.write(file);
    return note ?? null;
  }

  private async read(): Promise<NotesFile> {
    try {
      const raw = JSON.parse(await readFile(this.file(), 'utf8')) as Partial<NotesFile>;
      const items = Array.isArray(raw.items) ? raw.items.filter(isNote) : [];
      return { version: 1, items };
    } catch {
      return { version: 1, items: [] };
    }
  }

  private async write(file: NotesFile): Promise<void> {
    const path = this.file();
    await mkdir(parentDir(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(file)}\n`, 'utf8');
    await rename(tmp, path);
  }
}

function isNote(value: unknown): value is NoteItem {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<NoteItem>;
  return typeof note.id === 'string' && typeof note.text === 'string' && typeof note.done === 'boolean';
}

/**
 * Réponse express. `null` : le tour continue (l'effacement sur le PC ou le
 * téléphone passe par l'outil, avec confirmation). L'enceinte n'efface pas.
 */
export async function expressNoteReply(book: NotesBook, intent: NoteIntent, place: NotePlace): Promise<string | null> {
  if (intent.kind === 'erase') {
    if (place !== 'enceinte') return null;
    return "L'effacement se fait sur le PC ou le téléphone.";
  }
  if (intent.kind === 'add') {
    const note = await book.add(intent.body);
    return `C'est noté : ${formatNote(note)}.`;
  }
  if (intent.kind === 'list') {
    const pending = (await book.list()).filter((note) => !note.done);
    if (pending.length === 0) return 'Aucune note.';
    return pending.map((note) => formatNote(note)).join(' ; ');
  }
  const note = await book.check(intent.query);
  return note ? `C'est coché : ${formatNote(note)}.` : `Je n'ai pas trouvé « ${intent.query} ».`;
}

function parentDir(file: string): string {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return cut > 0 ? file.slice(0, cut) : '.';
}

export function notesFilePath(userData: string): string {
  return join(userData, 'notes.json');
}
