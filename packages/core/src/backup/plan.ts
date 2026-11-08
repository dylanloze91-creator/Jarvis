/** Nombre de sauvegardes gardées quand le réglage est absent. */
export const BACKUP_KEEP_DEFAULT = 4;
export const BACKUP_KEEP_MAX = 48;
/** Zip32 : au-delà, le fichier ne tient pas (4 Gio). */
export const BACKUP_MAX_FILE_BYTES = 0xffffffff;
export const BACKUP_MAX_ENTRIES = 65535;
/** Après un échec, on réessaie au plus tôt une heure plus tard. */
export const BACKUP_RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;

export const BACKUP_NAME = /^jarvis-sauvegarde-\d{8}T\d{6}Z\.zip$/;

export type BackupFrequency = 'daily' | 'weekly';

export interface BackupEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  version: 1;
  jarvis: string;
  createdAt: string;
  entries: BackupEntry[];
  /** Après une restauration, Spotify, Google et le coffre sont à reconnecter. */
  note: string;
}

export const BACKUP_RESTORE_NOTE =
  'Cette sauvegarde ne contient ni les jetons Spotify, ni les jetons Google, ni le coffre des clés. Après une restauration, reconnecte ces services.';

export function backupKeepCount(keep: number | undefined): number {
  if (keep === undefined || !Number.isInteger(keep) || keep < 1) return BACKUP_KEEP_DEFAULT;
  return Math.min(keep, BACKUP_KEEP_MAX);
}

/** Champ « sauvegardes gardées » : vide = défaut du code, sinon 1 à 48. */
export function backupKeepFromField(raw: string): { keep?: number; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (!/^\d+$/.test(trimmed)) return { error: 'Entre 1 et 48.' };
  const keep = Number(trimmed);
  if (keep < 1 || keep > BACKUP_KEEP_MAX) return { error: 'Entre 1 et 48.' };
  return { keep };
}

export function backupTooBigMessage(bytes: number, label: string): string | null {
  if (bytes > BACKUP_MAX_FILE_BYTES) return `Ce fichier est trop gros pour la sauvegarde : ${label}`;
  return null;
}

export function backupFrequencyOf(frequency: string | undefined): BackupFrequency {
  return frequency === 'weekly' ? 'weekly' : 'daily';
}

export function backupPeriodMs(frequency: BackupFrequency): number {
  return frequency === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

/** Nom stable, sans « : », pour Windows. */
export function backupZipName(at: Date): string {
  const iso = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `jarvis-sauvegarde-${iso}.zip`;
}

export function backupPartialName(zipName: string): string {
  return `${zipName}.partiel`;
}

export function buildManifest(entries: readonly BackupEntry[], jarvis: string, at: Date): BackupManifest {
  return {
    version: 1,
    jarvis,
    createdAt: at.toISOString(),
    entries: [...entries].sort((a, b) => a.path.localeCompare(b.path)),
    note: BACKUP_RESTORE_NOTE,
  };
}

export function verifyManifest(manifest: BackupManifest, actual: readonly BackupEntry[]): string[] {
  const wanted = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const seen = new Map(actual.map((entry) => [entry.path, entry]));
  const problems: string[] = [];
  for (const [path, entry] of wanted) {
    const got = seen.get(path);
    if (!got) problems.push(`${path} : absent`);
    else if (got.sha256 !== entry.sha256 || got.bytes !== entry.bytes) problems.push(`${path} : empreinte fausse`);
  }
  for (const path of seen.keys()) {
    if (!wanted.has(path) && path !== 'manifeste.json') problems.push(`${path} : en trop`);
  }
  return problems;
}

/** Ne supprime que les `jarvis-sauvegarde-*.zip`, les plus anciennes au-delà du nombre gardé. */
export function backupsToDelete(names: readonly string[], keep: number, exclude: readonly string[] = []): string[] {
  const kept = new Set(exclude);
  const own = names.filter((name) => BACKUP_NAME.test(name) && !kept.has(name)).sort();
  const extra = own.length - keep;
  if (extra <= 0) return [];
  return own.slice(0, extra);
}

export function shouldRunAutomaticBackup(input: {
  now: number;
  lastSuccessAt: number | null;
  failedAt?: number | null;
  frequency: BackupFrequency;
  idle: boolean;
  directoryReady: boolean;
}): boolean {
  if (!input.idle || !input.directoryReady) return false;
  if (input.failedAt != null && input.now - input.failedAt < BACKUP_RETRY_AFTER_FAILURE_MS) return false;
  if (input.lastSuccessAt == null) return true;
  return input.now - input.lastSuccessAt >= backupPeriodMs(input.frequency);
}

export function manifestIsValid(value: unknown): value is BackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<BackupManifest>;
  if (record.version !== 1 || typeof record.jarvis !== 'string' || typeof record.createdAt !== 'string' || typeof record.note !== 'string') {
    return false;
  }
  if (!Array.isArray(record.entries)) return false;
  return record.entries.every(
    (entry) =>
      !!entry &&
      typeof entry === 'object' &&
      typeof entry.path === 'string' &&
      typeof entry.bytes === 'number' &&
      typeof entry.sha256 === 'string',
  );
}

/** Chemin intérieur du zip : relatif, sans remontée. */
export function safeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '')) return null;
  return normalized;
}
