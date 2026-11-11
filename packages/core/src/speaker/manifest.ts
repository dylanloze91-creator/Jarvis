/**
 * Programme de l'enceinte livré avec Jarvis. Fonctions pures : adresses lues dans la table
 * des partitions, empreintes, aucun chevauchement. Aucun fichier `.bin` n'est dans git.
 */

export const SPEAKER_FW_CHIP = 'ESP32-S3';
export const SPEAKER_FW_FLASH_BYTES = 8 * 1024 * 1024;
export const SPEAKER_FW_FILES = ['bootloader.bin', 'partitions.bin', 'firmware.bin', 'srmodels.bin'] as const;
export type SpeakerFwFileName = (typeof SPEAKER_FW_FILES)[number];

export interface SpeakerFwFile {
  name: SpeakerFwFileName;
  offset: number;
  size: number;
  sha256: string;
}

export interface SpeakerFwManifest {
  version: string;
  chip: typeof SPEAKER_FW_CHIP;
  flashSize: '8MB';
  commit: string;
  files: SpeakerFwFile[];
}

export interface PartitionRow {
  name: string;
  type: string;
  subtype: string;
  offset: number;
  size: number;
}

/** Lit `partitions.csv` (nom, type, sous-type, offset, taille). Les commentaires sont ignorés. */
export function parsePartitionTable(csv: string): PartitionRow[] {
  const rows: PartitionRow[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = line.split(',').map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const offset = Number.parseInt(cells[3] ?? '', 16);
    const size = Number.parseInt(cells[4] ?? '', 16);
    const name = cells[0] ?? '';
    const type = cells[1] ?? '';
    const subtype = cells[2] ?? '';
    if (!name || !Number.isFinite(offset) || !Number.isFinite(size)) continue;
    rows.push({ name, type, subtype, offset, size });
  }
  return rows;
}

/**
 * Adresses d'écriture. Le bootloader ESP32-S3 est à 0x0, la table à 0x8000.
 * L'application est la partition `factory` ou `ota_0`. Le modèle est la partition `model`.
 */
export function firmwareOffsets(rows: readonly PartitionRow[]): Record<SpeakerFwFileName, number> | null {
  const app = rows.find((row) => row.type === 'app' && (row.subtype === 'factory' || row.subtype === 'ota_0'));
  const model = rows.find((row) => row.name === 'model');
  if (!app || !model) return null;
  return {
    'bootloader.bin': 0x0,
    'partitions.bin': 0x8000,
    'firmware.bin': app.offset,
    'srmodels.bin': model.offset,
  };
}

export type ManifestIssue =
  | 'fichier-manquant'
  | 'empreinte'
  | 'adresse'
  | 'chevauchement'
  | 'hors-flash'
  | 'puce'
  | 'version';

export function checkFirmwareManifest(
  manifest: SpeakerFwManifest,
  files: Partial<Record<SpeakerFwFileName, Uint8Array>>,
  digests: Partial<Record<SpeakerFwFileName, string>>,
): { ok: true } | { ok: false; issue: ManifestIssue; file?: string } {
  if (manifest.chip !== SPEAKER_FW_CHIP) return { ok: false, issue: 'puce' };
  if (!manifest.version.trim()) return { ok: false, issue: 'version' };
  if (manifest.files.length !== SPEAKER_FW_FILES.length) return { ok: false, issue: 'fichier-manquant' };
  const seen = new Set<string>();
  const spans: Array<{ name: string; start: number; end: number }> = [];
  for (const name of SPEAKER_FW_FILES) {
    const entry = manifest.files.find((file) => file.name === name);
    if (!entry) return { ok: false, issue: 'fichier-manquant', file: name };
    if (seen.has(name)) return { ok: false, issue: 'chevauchement', file: name };
    seen.add(name);
    const bytes = files[name];
    if (!bytes) return { ok: false, issue: 'fichier-manquant', file: name };
    if (bytes.byteLength !== entry.size || entry.size <= 0) return { ok: false, issue: 'adresse', file: name };
    const digest = (digests[name] ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(digest) || digest !== entry.sha256.toLowerCase()) {
      return { ok: false, issue: 'empreinte', file: name };
    }
    if (entry.offset < 0 || entry.offset + entry.size > SPEAKER_FW_FLASH_BYTES) {
      return { ok: false, issue: 'hors-flash', file: name };
    }
    spans.push({ name, start: entry.offset, end: entry.offset + entry.size });
  }
  spans.sort((a, b) => a.start - b.start);
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1]!;
    const current = spans[index]!;
    if (current.start < previous.end) return { ok: false, issue: 'chevauchement', file: current.name };
  }
  return { ok: true };
}

/** Même version déjà sur la carte : on ne réécrit pas la flash. */
export function sameFirmware(cardVersion: string | null | undefined, manifestVersion: string): boolean {
  return Boolean(cardVersion && cardVersion.trim() === manifestVersion.trim());
}
