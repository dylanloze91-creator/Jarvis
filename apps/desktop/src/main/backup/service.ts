import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  BACKUP_MAX_ENTRIES,
  BACKUP_NAME,
  backupFrequencyOf,
  backupKeepCount,
  backupPartialName,
  backupZipName,
  backupsToDelete,
  blankSecrets,
  buildManifest,
  manifestIsValid,
  parseSettings,
  safeZipPath,
  shouldRunAutomaticBackup,
  type BackupManifest,
  type Settings,
} from '@jarvis/core';
import { measurePieces, publishPartial, readZipEntry, verifyZipEntries, writeVerifiedZip, type ArchivePiece } from './archive.js';

const STATE_FILE = 'sauvegarde-etat.json';
const SKIP = new Set(['spotify-token.json', 'google-token.bin', 'coffre.bin', STATE_FILE]);
const ROOT_FILES = ['personalization.json', 'knowledge-index.json', 'questionnaire.json', 'phone.json', 'speakers.json'];
const ROOT_DIRS = ['conversations', 'developer', 'wake-learning'];

export interface BackupState {
  lastSuccessAt: number | null;
  failedAt: number | null;
  ok: boolean;
  file: string;
  error: string;
}

export interface BackupRunResult {
  ok: boolean;
  file: string;
  error: string;
}

const EMPTY_STATE: BackupState = { lastSuccessAt: null, failedAt: null, ok: true, file: '', error: '' };

function isWithin(parent: string, child: string): boolean {
  const base = resolve(parent);
  const target = resolve(child);
  const rel = relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function walk(dir: string, root: string, out: string[], destDir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git' || name.endsWith('.partiel')) continue;
    const abs = join(dir, name);
    const info = await lstat(abs).catch(() => null);
    if (!info || info.isSymbolicLink()) continue;
    if (destDir && isWithin(destDir, abs)) continue;
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (SKIP.has(rel) || SKIP.has(name)) continue;
    if (info.isDirectory()) await walk(abs, root, out, destDir);
    else if (info.isFile()) out.push(abs);
  }
}

async function ggufFiles(dir: string, destDir: string): Promise<string[]> {
  const out: string[] = [];
  await walk(dir, dir, out, destDir);
  return out.filter((file) => file.toLowerCase().endsWith('.gguf'));
}

export class BackupService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      userData: () => string;
      getSettings: () => Settings;
      version: () => string;
      isIdle: () => boolean;
      now?: () => Date;
      relaunch?: () => void;
    },
  ) {}

  start(everyMs = 15 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.backupIfDue();
    }, everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async state(): Promise<BackupState> {
    try {
      const raw = JSON.parse(await readFile(join(this.deps.userData(), STATE_FILE), 'utf8')) as Partial<BackupState> & {
        lastAt?: number;
      };
      const legacyAt = typeof raw.lastAt === 'number' ? raw.lastAt : null;
      const ok = raw.ok !== false;
      return {
        lastSuccessAt: typeof raw.lastSuccessAt === 'number' ? raw.lastSuccessAt : ok ? legacyAt : null,
        failedAt: typeof raw.failedAt === 'number' ? raw.failedAt : ok ? null : legacyAt,
        ok,
        file: typeof raw.file === 'string' ? raw.file : '',
        error: typeof raw.error === 'string' ? raw.error : '',
      };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  async backupIfDue(): Promise<BackupRunResult | null> {
    const settings = this.deps.getSettings();
    const directory = settings.backup?.directory?.trim() ?? '';
    const state = await this.state();
    const due = shouldRunAutomaticBackup({
      now: (this.deps.now?.() ?? new Date()).getTime(),
      lastSuccessAt: state.lastSuccessAt,
      failedAt: state.failedAt,
      frequency: backupFrequencyOf(settings.backup?.frequency),
      idle: this.deps.isIdle(),
      directoryReady: Boolean(directory),
    });
    if (!due) return null;
    return this.backupNow();
  }

  async backupNow(options?: { rotate?: boolean }): Promise<BackupRunResult> {
    if (this.running) return { ok: false, file: '', error: 'Une sauvegarde est déjà en cours.' };
    const settings = this.deps.getSettings();
    const directory = settings.backup?.directory?.trim() ?? '';
    if (!directory) return { ok: false, file: '', error: 'Choisis d’abord un dossier de sauvegarde.' };
    this.running = true;
    const at = this.deps.now?.() ?? new Date();
    const name = backupZipName(at);
    const partial = join(directory, backupPartialName(name));
    const finalPath = join(directory, name);
    const previous = await this.state();
    try {
      await mkdir(directory, { recursive: true });
      const pieces = await this.pieces(settings, directory);
      if (pieces.length + 1 > BACKUP_MAX_ENTRIES) {
        throw new Error('Ce fichier est trop gros pour la sauvegarde : trop de fichiers.');
      }
      const manifest = buildManifest(await measurePieces(pieces), this.deps.version(), at);
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
      const written = await writeVerifiedZip(partial, [...pieces, { zipPath: 'manifeste.json', data: manifestBytes }], at);
      const problems = await verifyZipEntries(
        partial,
        written.entries.filter((entry) => entry.path !== 'manifeste.json'),
      );
      const manifestProblems = verifyManifestEntries(manifest, written.entries.filter((entry) => entry.path !== 'manifeste.json'));
      if (problems.length || manifestProblems.length) {
        await rm(partial, { force: true });
        const error = [...problems, ...manifestProblems][0] ?? 'empreinte fausse';
        await this.writeState({ ...previous, failedAt: at.getTime(), ok: false, file: '', error });
        return { ok: false, file: '', error };
      }
      await publishPartial(partial, finalPath);
      if (options?.rotate !== false) await this.rotate(directory, backupKeepCount(settings.backup?.keep));
      await this.writeState({ lastSuccessAt: at.getTime(), failedAt: null, ok: true, file: name, error: '' });
      return { ok: true, file: name, error: '' };
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      await this.writeState({ ...previous, failedAt: at.getTime(), ok: false, file: '', error: message });
      return { ok: false, file: '', error: message };
    } finally {
      this.running = false;
    }
  }

  async list(): Promise<Array<{ name: string; manifest: BackupManifest | null }>> {
    const directory = this.deps.getSettings().backup?.directory?.trim() ?? '';
    if (!directory) return [];
    let names: string[] = [];
    try {
      names = await readdir(directory);
    } catch {
      return [];
    }
    const zips = names.filter((name) => BACKUP_NAME.test(name)).sort().reverse();
    const out = [];
    for (const name of zips) {
      const raw = await readZipEntry(join(directory, name), 'manifeste.json');
      let manifest: BackupManifest | null = null;
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
          if (isRecord(parsed) && parsed.version === 1 && Array.isArray(parsed.entries)) manifest = parsed as unknown as BackupManifest;
        } catch {
          manifest = null;
        }
      }
      out.push({ name, manifest });
    }
    return out;
  }

  /** À appeler seulement après une carte de confirmation. Vérifie le zip avant toute écriture. */
  async restore(name: string): Promise<BackupRunResult> {
    if (!BACKUP_NAME.test(basename(name))) return { ok: false, file: '', error: 'Ce fichier n’est pas une sauvegarde Jarvis.' };
    const directory = this.deps.getSettings().backup?.directory?.trim() ?? '';
    if (!directory) return { ok: false, file: '', error: 'Choisis d’abord un dossier de sauvegarde.' };
    const zipPath = join(directory, basename(name));
    const manifest = await readManifest(zipPath);
    if (!manifestIsValid(manifest)) return { ok: false, file: '', error: 'Cette sauvegarde ne peut pas être relue.' };
    const problems = await verifyZipEntries(zipPath, manifest.entries);
    if (problems.length) return { ok: false, file: '', error: problems[0] ?? 'empreinte fausse' };
    const safety = await this.backupNow({ rotate: false });
    if (!safety.ok) return { ok: false, file: '', error: `Copie de sécurité impossible : ${safety.error}` };
    try {
      const settings = this.deps.getSettings();
      await extractZip(zipPath, {
        userData: this.deps.userData(),
        trainingDir: settings.backup?.trainingDir?.trim() || null,
        modelsDir: settings.backup?.modelsDir?.trim() || null,
      });
    } catch (error) {
      return { ok: false, file: safety.file, error: error instanceof Error ? error.message : String(error) };
    }
    this.deps.relaunch?.();
    return { ok: true, file: basename(name), error: '' };
  }

  private async pieces(settings: Settings, destDir: string): Promise<ArchivePiece[]> {
    const root = this.deps.userData();
    const pieces: ArchivePiece[] = [];
    const settingsRaw = await readFile(join(root, 'settings.json'), 'utf8').catch(() => '');
    let stripped = blankSecrets(settings);
    if (settingsRaw) {
      try {
        stripped = blankSecrets(parseSettings(JSON.parse(settingsRaw), settings));
      } catch {
        stripped = blankSecrets(settings);
      }
    }
    pieces.push({ zipPath: 'settings.json', data: new TextEncoder().encode(JSON.stringify(stripped, null, 2)) });
    for (const name of ROOT_FILES) {
      const abs = join(root, name);
      if (await stat(abs).then((info) => info.isFile()).catch(() => false)) pieces.push({ zipPath: name, source: abs });
    }
    for (const dir of ROOT_DIRS) {
      const files: string[] = [];
      await walk(join(root, dir), root, files, destDir);
      for (const abs of files) {
        const zipPath = relative(root, abs).replace(/\\/g, '/');
        if (safeZipPath(zipPath)) pieces.push({ zipPath, source: abs });
      }
    }
    if (settings.backup?.includeTrainingData && settings.backup.trainingDir?.trim()) {
      const files: string[] = [];
      const base = settings.backup.trainingDir.trim();
      await walk(base, base, files, destDir);
      for (const abs of files) {
        const zipPath = `jarvis-data/${relative(base, abs).replace(/\\/g, '/')}`;
        if (safeZipPath(zipPath)) pieces.push({ zipPath, source: abs });
      }
    }
    if (settings.backup?.includeModels && settings.backup.modelsDir?.trim()) {
      const base = settings.backup.modelsDir.trim();
      for (const abs of await ggufFiles(base, destDir)) {
        const zipPath = `modeles/${basename(abs)}`;
        if (safeZipPath(zipPath)) pieces.push({ zipPath, source: abs });
      }
    }
    return pieces;
  }

  private async rotate(directory: string, keep: number): Promise<void> {
    const names = await readdir(directory).catch(() => [] as string[]);
    for (const name of backupsToDelete(names, keep)) {
      if (!BACKUP_NAME.test(name)) continue;
      await rm(join(directory, name), { force: true });
    }
  }

  private async writeState(state: BackupState): Promise<void> {
    await mkdir(this.deps.userData(), { recursive: true });
    const tmp = join(this.deps.userData(), `${STATE_FILE}.tmp`);
    await writeFile(tmp, JSON.stringify(state), 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(tmp, join(this.deps.userData(), STATE_FILE));
  }
}

function verifyManifestEntries(manifest: BackupManifest, entries: { path: string; bytes: number; sha256: string }[]): string[] {
  const got = new Map(entries.map((entry) => [entry.path, entry]));
  const problems: string[] = [];
  for (const entry of manifest.entries) {
    const found = got.get(entry.path);
    if (!found || found.sha256 !== entry.sha256 || found.bytes !== entry.bytes) problems.push(`${entry.path} : empreinte fausse`);
  }
  return problems;
}

async function readManifest(zipPath: string): Promise<BackupManifest | null> {
  const raw = await readZipEntry(zipPath, 'manifeste.json');
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    return manifestIsValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function extractZip(
  zipPath: string,
  dest: { userData: string; trainingDir: string | null; modelsDir: string | null },
): Promise<void> {
  const { open, mkdir: makeDir, rename, rm: remove } = await import('node:fs/promises');
  const { createWriteStream } = await import('node:fs');
  const file = await open(zipPath, 'r');
  try {
    for (;;) {
      const header = Buffer.alloc(30);
      const read = await file.read(header, 0, 30, null);
      if (read.bytesRead < 30) break;
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      if (view.getUint32(0, true) !== 0x04034b50) break;
      const nameLength = view.getUint16(26, true);
      const extraLength = view.getUint16(28, true);
      const size = view.getUint32(22, true);
      const nameBuf = Buffer.alloc(nameLength);
      await file.read(nameBuf, 0, nameLength, null);
      if (extraLength) await file.read(Buffer.alloc(extraLength), 0, extraLength, null);
      const name = safeZipPath(nameBuf.toString('utf8'));
      let target: string | null = null;
      if (name && name !== 'manifeste.json' && !SKIP.has(name)) {
        if (name.startsWith('jarvis-data/') && dest.trainingDir) target = join(dest.trainingDir, name.slice('jarvis-data/'.length));
        else if (name.startsWith('modeles/') && dest.modelsDir) target = join(dest.modelsDir, name.slice('modeles/'.length));
        else if (!name.startsWith('jarvis-data/') && !name.startsWith('modeles/')) target = join(dest.userData, name);
      }
      if (!target) {
        const skip = Buffer.alloc(64 * 1024);
        let left = size;
        while (left > 0) {
          const got = await file.read(skip, 0, Math.min(skip.length, left), null);
          if (!got.bytesRead) break;
          left -= got.bytesRead;
        }
        continue;
      }
      await makeDir(join(target, '..'), { recursive: true });
      const tmp = `${target}.tmp`;
      const out = createWriteStream(tmp, { mode: 0o600 });
      const failed = new Promise<never>((_, reject) => {
        out.on('error', reject);
      });
      let left = size;
      try {
        while (left > 0) {
          const chunk = Buffer.alloc(Math.min(left, 64 * 1024));
          const got = await file.read(chunk, 0, chunk.length, null);
          if (!got.bytesRead) break;
          const slice = chunk.subarray(0, got.bytesRead);
          await Promise.race([
            new Promise<void>((resolve, reject) => out.write(slice, (error) => (error ? reject(error) : resolve()))),
            failed,
          ]);
          left -= got.bytesRead;
        }
        await Promise.race([
          new Promise<void>((resolve, reject) => out.end((error: Error | null | undefined) => (error ? reject(error) : resolve()))),
          failed,
        ]);
        await rename(tmp, target);
      } catch (error) {
        out.destroy();
        await remove(tmp, { force: true });
        throw error;
      }
    }
  } finally {
    await file.close();
  }
}
