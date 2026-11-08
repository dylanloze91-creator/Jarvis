/** Nombre de sauvegardes gardées quand le réglage est absent. */
export const BACKUP_KEEP_DEFAULT = 4;

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
  return keep;
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
export function backupsToDelete(names: readonly string[], keep: number): string[] {
  const own = names.filter((name) => BACKUP_NAME.test(name)).sort();
  const extra = own.length - keep;
  if (extra <= 0) return [];
  return own.slice(0, extra);
}

export function shouldRunAutomaticBackup(input: {
  now: number;
  lastAt: number | null;
  frequency: BackupFrequency;
  idle: boolean;
  directoryReady: boolean;
}): boolean {
  if (!input.idle || !input.directoryReady) return false;
  if (input.lastAt === null) return true;
  return input.now - input.lastAt >= backupPeriodMs(input.frequency);
}

/** Chemin intérieur du zip : relatif, sans remontée. */
export function safeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '')) return null;
  return normalized;
}
