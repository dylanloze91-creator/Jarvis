/**
 * Fichiers des notes et des routines. Module Node, hors de l'index du cœur :
 * la fenêtre ne doit pas l'importer.
 * `userData/notes.json` et `userData/routines.json`.
 *
 * Lecture et écriture passent par `StateFileIO`. Jarvis lui donne l'écriture sûre du bureau
 * (`safeFile.ts`, 5.0.78 : forcée sur le disque, copie `.bak` reprise si le fichier est abîmé),
 * comme pour les autres fichiers d'état. Sans `io` (tests du cœur) : temporaire puis renommage.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  formatNote,
  noteMatches,
  parseNoteBody,
  type NoteIntent,
  type NoteItem,
  type NotePlace,
} from './notes.js';
import {
  routineAction,
  routineNamesMatch,
  runRoutineSteps,
  type Routine,
  type RoutineStep,
  type StepRunner,
} from './routines.js';

/**
 * Lecture et écriture d'un fichier d'état texte. `parse` lève une erreur si le contenu
 * ne se lit pas : c'est lui qui décide si un fichier est abîmé, et si la version actuelle
 * peut devenir la copie de secours.
 */
export interface StateFileIO {
  /** Contenu lu par `parse`, ou `null` si le fichier n'existe pas ou n'a rien de lisible. */
  read<T>(path: string, parse: (text: string) => T): Promise<T | null>;
  write(path: string, text: string, parse: (text: string) => unknown): Promise<void>;
}

/** Sans l'écriture sûre du bureau : comportement du lot B (temporaire puis renommage). */
export const plainStateFileIO: StateFileIO = {
  async read<T>(path: string, parse: (text: string) => T): Promise<T | null> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      return null;
    }
    try {
      return parse(text);
    } catch {
      return null;
    }
  },
  async write(path: string, text: string): Promise<void> {
    await mkdir(parentDir(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, path);
  },
};

/** Un fichier des notes ou des routines est un objet JSON ; sinon il est abîmé. */
function parseStateObject(text: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('pas un objet JSON');
  return raw as Record<string, unknown>;
}

interface NotesFile {
  version: 1;
  items: NoteItem[];
}

function parseNotesFile(text: string): NotesFile {
  const raw = parseStateObject(text);
  return { version: 1, items: Array.isArray(raw.items) ? raw.items.filter(isNote) : [] };
}

export class NotesBook {
  constructor(
    private readonly pathOf: () => string,
    private readonly io: StateFileIO = plainStateFileIO,
  ) {}

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
    return (await this.io.read(this.file(), parseNotesFile)) ?? { version: 1, items: [] };
  }

  private async write(file: NotesFile): Promise<void> {
    await this.io.write(this.file(), `${JSON.stringify(file)}\n`, parseNotesFile);
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

interface RoutineFile {
  version: 1;
  items: Routine[];
  pending: { name: string; steps: RoutineStep[] } | null;
}

function parseRoutineFile(text: string): RoutineFile {
  const raw = parseStateObject(text);
  return {
    version: 1,
    items: Array.isArray(raw.items) ? raw.items.filter(isRoutine) : [],
    pending: raw.pending && isRoutine(raw.pending) ? (raw.pending as RoutineFile['pending']) : null,
  };
}

export class RoutineBook {
  constructor(
    private readonly pathOf: () => string,
    private readonly io: StateFileIO = plainStateFileIO,
  ) {}

  async list(): Promise<Routine[]> {
    return (await this.read()).items;
  }

  async names(): Promise<string[]> {
    return (await this.list()).map((routine) => routine.name);
  }

  async find(name: string): Promise<Routine | null> {
    return (await this.list()).find((routine) => routineNamesMatch(routine.name, name)) ?? null;
  }

  async stage(name: string, steps: RoutineStep[]): Promise<void> {
    const file = await this.read();
    file.pending = { name, steps };
    await this.write(file);
  }

  async clearPending(): Promise<void> {
    const file = await this.read();
    file.pending = null;
    await this.write(file);
  }

  async acceptPending(): Promise<Routine | null> {
    const file = await this.read();
    if (!file.pending) return null;
    const routine = { name: file.pending.name, steps: file.pending.steps };
    file.items = file.items.filter((item) => !routineNamesMatch(item.name, routine.name));
    file.items.push(routine);
    file.pending = null;
    await this.write(file);
    return routine;
  }

  async save(routine: Routine): Promise<void> {
    const file = await this.read();
    file.items = file.items.filter((item) => !routineNamesMatch(item.name, routine.name));
    file.items.push(routine);
    file.pending = null;
    await this.write(file);
  }

  private async read(): Promise<RoutineFile> {
    return (await this.io.read(this.pathOf(), parseRoutineFile)) ?? { version: 1, items: [], pending: null };
  }

  private async write(file: RoutineFile): Promise<void> {
    await this.io.write(this.pathOf(), `${JSON.stringify(file)}\n`, parseRoutineFile);
  }
}

function isRoutine(value: unknown): value is Routine {
  if (!value || typeof value !== 'object') return false;
  const routine = value as Partial<Routine>;
  return typeof routine.name === 'string' && Array.isArray(routine.steps);
}

export function routinesFilePath(userData: string): string {
  return join(userData, 'routines.json');
}

export async function handleRoutinePhrase(
  book: RoutineBook,
  text: string,
  io: {
    confirm: (summary: string) => Promise<boolean>;
    run: StepRunner;
  },
): Promise<string | null> {
  const action = routineAction(text, await book.names());
  if (!action) return null;
  if (action.kind === 'refused') return action.reason;
  if (action.kind === 'confirm') {
    const saved = await book.acceptPending();
    return saved ? `C'est enregistré : ${saved.name}.` : null;
  }
  if (action.kind === 'create') {
    await book.stage(action.name, action.steps);
    const approved = await io.confirm(action.summary);
    if (!approved) {
      await book.clearPending();
      return "Rien n'a été enregistré.";
    }
    const saved = await book.acceptPending();
    return saved ? `C'est enregistré : ${saved.name}.` : "Rien n'a été enregistré.";
  }
  const routine = await book.find(action.name);
  if (!routine) return `Je n'ai pas de routine ${action.name}.`;
  const detail = await runRoutineSteps(routine.steps, io.run);
  return `Routine ${routine.name} : ${detail}.`;
}
