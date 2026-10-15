import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isMissionState,
  summarizeMission,
  type MissionState,
  type MissionSummary,
} from '@jarvis/core';

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Quatre essais : le premier, puis trois pauses courtes. Les tests injectent un sommeil vide. */
const RENAME_DELAYS_MS = [30, 90, 200];

export type JournalWriteMode = 'renamed' | 'in-place';

export const JOURNAL_KEPT_LINE = 'Jeu écrit. Journal verrouillé, enregistré sur place.';
export const JOURNAL_UNSAVED_LINE = 'Jeu écrit. Journal non enregistré (fichier verrouillé).';
export const JOURNAL_MISSING_LINE = 'Le jeu n’a pas été écrit. Journal verrouillé.';

/** Erreur disque du journal, sans chemin : le message ne doit pas exposer AppData. */
export class JournalLockError extends Error {
  constructor(message = 'Journal de mission verrouillé.') {
    super(message);
    this.name = 'JournalLockError';
  }
}

export interface JournalIo {
  writeFile?: (path: string, data: string) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  mkdir?: (path: string, options: { recursive: boolean }) => Promise<void>;
  rm?: (path: string, options: { force: boolean }) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

function lockCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isLockCode(error: unknown): boolean {
  const code = lockCode(error);
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

/** Verrou du journal (rename `.tmp` sous `missions`), pas une erreur de jeu. */
export function isJournalLock(error: unknown): boolean {
  if (error instanceof JournalLockError) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/Journal de mission verrouillé|Journal verrouillé/i.test(message)) return true;
  const locked =
    isLockCode(error) || /EPERM|EBUSY|EACCES|operation not permitted/i.test(message);
  return locked && /rename|missions|\.tmp/i.test(message);
}

export function journalOutcomeLine(gameWritten: boolean, savedInPlace: boolean): string {
  if (!gameWritten) return JOURNAL_MISSING_LINE;
  return savedInPlace ? JOURNAL_KEPT_LINE : JOURNAL_UNSAVED_LINE;
}

/** Le dossier du jeu a déjà reçu des fichiers (Node, page web ou projet .NET). */
export function gameFolderWritten(root: string | null | undefined): boolean {
  if (!root || !existsSync(root)) return false;
  if (
    existsSync(join(root, 'package.json')) ||
    existsSync(join(root, 'index.html')) ||
    existsSync(join(root, 'src'))
  ) {
    return true;
  }
  try {
    return readdirSync(root).some((name) => name.endsWith('.csproj') || name.endsWith('.sln'));
  } catch {
    return false;
  }
}

/**
 * Texte du chat quand le journal est en cause.
 * `text` est une seule ligne française, sans chemin.
 * `null` : pas un verrou de journal, l’appelant garde son message habituel.
 */
export function creationJournalBanner(input: {
  ok: boolean;
  folderWritten: boolean;
  journalNote?: string | null;
  summary?: string | null;
}): { kept: boolean; failedShort: boolean; text: string | null } {
  const note = input.journalNote?.trim() ?? '';
  const summary = input.summary?.trim() ?? '';
  const locked = isJournalLock(note) || isJournalLock(summary);
  if (note.startsWith('Jeu écrit') || (input.folderWritten && locked)) {
    const text = note.startsWith('Jeu écrit')
      ? note
      : journalOutcomeLine(true, false);
    return { kept: true, failedShort: false, text };
  }
  if (!input.ok && (locked || note.startsWith('Le jeu'))) {
    const text = note.startsWith('Le jeu') ? note : JOURNAL_MISSING_LINE;
    return { kept: false, failedShort: true, text };
  }
  return { kept: false, failedShort: false, text: null };
}

async function replaceJournal(
  target: string,
  temporary: string,
  body: string,
  io: JournalIo,
): Promise<JournalWriteMode> {
  const write = io.writeFile ?? writeFile;
  const ren = io.rename ?? rename;
  const remove = io.rm ?? rm;
  const sleep =
    io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  await write(temporary, body);
  let last: unknown;
  for (let attempt = 0; attempt <= RENAME_DELAYS_MS.length; attempt++) {
    try {
      await ren(temporary, target);
      return 'renamed';
    } catch (error) {
      last = error;
      if (!isLockCode(error) || attempt === RENAME_DELAYS_MS.length) break;
      await sleep(RENAME_DELAYS_MS[attempt]!);
    }
  }
  if (!isLockCode(last)) throw last;
  try {
    await write(target, body);
  } catch (error) {
    if (isLockCode(error)) throw new JournalLockError();
    throw error;
  }
  await remove(temporary, { force: true }).catch(() => undefined);
  return 'in-place';
}

/**
 * Missions d'un projet, dans les données de Jarvis (décision D3) :
 * `<userData>/developer/projects/<projet>/missions/<id>.json`. Rien n'est
 * écrit dans le dépôt du projet.
 */
export class MissionStore {
  /** Écritures en file : deux mises à jour proches d'une mission ne se marchent pas dessus. */
  private queue: Promise<void> = Promise.resolve();
  private written = 0;

  constructor(
    private readonly root: () => string,
    private readonly io: JournalIo = {},
  ) {}

  private dir(projectId: string): string {
    if (!ID.test(projectId)) throw new Error(`Projet invalide : ${projectId}`);
    return join(this.root(), projectId, 'missions');
  }

  save(mission: MissionState): Promise<JournalWriteMode> {
    if (!ID.test(mission.id)) return Promise.reject(new Error(`Mission invalide : ${mission.id}`));
    const body = JSON.stringify(mission, null, 2);
    const dir = this.dir(mission.projectId);
    const next = this.queue.then(async () => {
      const makeDir = this.io.mkdir ?? mkdir;
      await makeDir(dir, { recursive: true });
      const target = join(dir, `${mission.id}.json`);
      this.written += 1;
      const temporary = `${target}.${this.written}.tmp`;
      return replaceJournal(target, temporary, body, this.io);
    });
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Une mission « Nouveau projet » rejoint son projet une fois créé. */
  async move(mission: MissionState, from: string): Promise<void> {
    await this.save(mission);
    if (from === mission.projectId || !ID.test(mission.id)) return;
    const next = this.queue.then(() =>
      rm(join(this.dir(from), `${mission.id}.json`), { force: true }),
    );
    this.queue = next.catch(() => undefined);
    await next;
  }

  async load(projectId: string, id: string): Promise<MissionState | null> {
    if (!ID.test(id)) return null;
    try {
      const value = JSON.parse(await readFile(join(this.dir(projectId), `${id}.json`), 'utf8'));
      return isMissionState(value) ? value : null;
    } catch {
      return null;
    }
  }

  async list(projectId: string, limit = 30): Promise<MissionSummary[]> {
    await this.queue;
    let names: string[] = [];
    try {
      names = (await readdir(this.dir(projectId))).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }
    const out: MissionSummary[] = [];
    for (const name of names) {
      const mission = await this.load(projectId, name.slice(0, -'.json'.length));
      if (mission) out.push(summarizeMission(mission));
    }
    return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}
