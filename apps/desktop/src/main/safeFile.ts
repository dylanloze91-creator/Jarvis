import { randomBytes } from 'node:crypto';
import { access, copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

/**
 * Écriture sûre des fichiers d'état de Jarvis (`settings.json`, `speakers.json`, `phone.json`…).
 *
 * Constat du 13 novembre 2026 : après deux coupures de courant, `speakers.json` a été retrouvé
 * rempli de zéros (413 octets nuls). L'écriture « fichier temporaire puis renommage » ne suffit
 * pas : Windows peut garder le renommage et perdre les données encore en mémoire. L'enceinte
 * de la chambre a perdu sa clé (401).
 *
 * Ordre suivi ici :
 *   1. écrire le contenu dans un fichier temporaire, puis le forcer sur le disque (`fsync`) ;
 *   2. copier la version actuelle, si elle est saine, en `<fichier>.bak` (forcée sur le disque) ;
 *   3. renommer le temporaire à la place du fichier.
 *
 * À la lecture : un fichier vide, rempli de zéros ou que `parse` refuse est mis de côté
 * (jamais effacé), puis le `.bak` est repris s'il se lit. Chaque cas est noté pour le bilan.
 */

export const BACKUP_SUFFIX = '.bak';

/** Un fichier abîmé trouvé à la lecture, pour le bilan de santé. */
export interface StateFileIncident {
  /** Nom du fichier (sans dossier), par exemple `speakers.json`. */
  file: string;
  /** Pourquoi il a été jugé abîmé. */
  reason: 'zeros' | 'empty' | 'unreadable';
  /** `true` si la version précédente (`.bak`) a été reprise. */
  restored: boolean;
  /** Nom de la copie mise de côté (sans dossier), ou `null` si la mise de côté a échoué. */
  setAside: string | null;
  at: number;
}

const incidents: StateFileIncident[] = [];

/** Fichiers abîmés trouvés depuis le démarrage (lecture seule). */
export function stateFileIncidents(): readonly StateFileIncident[] {
  return incidents;
}

/** Pour les tests. */
export function resetStateFileIncidents(): void {
  incidents.length = 0;
}

/** Vide, ou uniquement des octets nuls : ce qu'une coupure laisse derrière elle. */
export function blankReason(bytes: Uint8Array): 'empty' | 'zeros' | null {
  if (bytes.length === 0) return 'empty';
  for (const byte of bytes) if (byte !== 0) return null;
  return 'zeros';
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Sous Windows on ne peut pas ouvrir un dossier : l'erreur est ignorée (le renommage NTFS est journalisé). */
async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* sans effet sous Windows */
  }
}

export interface WriteStateOptions {
  mode?: number;
  /** Garder la version précédente en `.bak` (défaut : oui). */
  keepBackup?: boolean;
}

/**
 * Écrit `data` dans `target` sans jamais laisser un fichier vide ou à moitié écrit,
 * et garde la version précédente saine en `<target>.bak`.
 */
export async function writeStateFile(
  target: string,
  data: string | Uint8Array,
  options: WriteStateOptions = {},
): Promise<void> {
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  const temp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(temp, 'w', options.mode ?? 0o600);
  try {
    await handle.writeFile(data, typeof data === 'string' ? { encoding: 'utf8' } : undefined);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();

  if (options.keepBackup !== false) {
    // La version actuelle ne devient le `.bak` que si elle est saine : un fichier de zéros
    // ne doit jamais écraser la dernière bonne copie.
    try {
      const current = await readFile(target);
      if (blankReason(current) === null) {
        const bak = await open(`${target}${BACKUP_SUFFIX}`, 'w', options.mode ?? 0o600);
        try {
          await bak.writeFile(current);
          await bak.sync();
        } finally {
          await bak.close();
        }
      }
    } catch {
      /* pas encore de fichier : rien à garder */
    }
  }

  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dir);
}

export interface ReadStateOptions {
  /** Suffixe de la copie mise de côté (défaut `illisible` : `speakers.json.illisible`). */
  asideSuffix?: string;
  /** Chemin complet de la copie mise de côté, à la place du suffixe (ex. `coffre.illisible.bin`). */
  asidePath?: string;
  /** Pour les journaux. */
  log?: (message: string) => void;
  now?: () => number;
}

export type ReadStateResult<T> =
  | { status: 'absent' }
  | { status: 'ok'; value: T }
  | { status: 'restored'; value: T; incident: StateFileIncident }
  | { status: 'damaged'; incident: StateFileIncident };

async function setAside(target: string, first: string, now: number): Promise<string | null> {
  // Une copie déjà mise de côté n'est jamais écrasée : la suivante porte la date.
  let aside = first;
  if (await exists(aside)) {
    const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    aside = `${first}-${stamp}`;
    let n = 2;
    while (await exists(aside)) aside = `${first}-${stamp}-${n++}`;
  }
  try {
    await rename(target, aside);
    return basename(aside);
  } catch {
    // Fichier verrouillé : une copie vaut mieux que rien ; l'original sera remplacé à la prochaine écriture.
    try {
      await copyFile(target, aside);
      return basename(aside);
    } catch {
      return null;
    }
  }
}

function tryParse<T>(bytes: Buffer, parse: (bytes: Buffer) => T): { ok: true; value: T } | { ok: false; reason: StateFileIncident['reason'] } {
  const blank = blankReason(bytes);
  if (blank) return { ok: false, reason: blank };
  try {
    return { ok: true, value: parse(bytes) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/**
 * Lit un fichier d'état. `parse` doit lever une erreur si le contenu n'est pas valable.
 * Fichier abîmé : mis de côté, `.bak` repris et réécrit à sa place s'il se lit.
 */
export async function readStateFile<T>(
  target: string,
  parse: (bytes: Buffer) => T,
  options: ReadStateOptions = {},
): Promise<ReadStateResult<T>> {
  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch (error) {
    // Le renommage remplace le fichier sans jamais le retirer : absent = jamais écrit, ou effacé
    // exprès (réinitialisation). Le `.bak` n'est pas repris dans ce cas.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'absent' };
    throw error;
  }
  const first = tryParse(bytes, parse);
  if (first.ok) return { status: 'ok', value: first.value };

  const now = options.now?.() ?? Date.now();
  const aside = await setAside(target, options.asidePath ?? `${target}.${options.asideSuffix ?? 'illisible'}`, now);
  const fromBackup = await readBackup(target, parse);
  const incident: StateFileIncident = {
    file: basename(target),
    reason: first.reason,
    restored: fromBackup !== null,
    setAside: aside,
    at: now,
  };
  incidents.push(incident);
  const why = first.reason === 'zeros' ? 'rempli de zéros' : first.reason === 'empty' ? 'vide' : 'illisible';
  (options.log ?? ((message) => console.error(message)))(
    `[jarvis] ${incident.file} ${why} : mis de côté (${aside ?? 'échec'})` +
      (fromBackup ? ', version précédente (.bak) reprise.' : ', aucune version précédente lisible.'),
  );
  if (!fromBackup) return { status: 'damaged', incident };
  await writeStateFile(target, fromBackup.bytes, { keepBackup: false }).catch(() => undefined);
  return { status: 'restored', value: fromBackup.value, incident };
}

async function readBackup<T>(target: string, parse: (bytes: Buffer) => T): Promise<{ value: T; bytes: Buffer } | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(`${target}${BACKUP_SUFFIX}`);
  } catch {
    return null;
  }
  const result = tryParse(bytes, parse);
  return result.ok ? { value: result.value, bytes } : null;
}

/** Lecteur JSON courant : texte UTF-8 (marque BOM tolérée) puis `JSON.parse`, et `check` éventuel. */
export function jsonParser<T>(check: (data: unknown) => T = (data) => data as T): (bytes: Buffer) => T {
  return (bytes) => check(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
}
