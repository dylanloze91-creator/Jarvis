import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Reservations, type ReservedFunction } from '@jarvis/core';

const FILE = 'edition.json';
const KEYS: readonly ReservedFunction[] = ['wakeWord', 'speaker', 'phone', 'shortcut'];

export interface EditionDisk extends Reservations {
  copyAsked?: boolean;
}

/** Lecture seule. Fichier absent ou illisible : rien n'est activé. */
export function parseEditionDisk(raw: string): EditionDisk {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    const out: EditionDisk = {};
    for (const key of KEYS) {
      if (record[key] === true) out[key] = true;
    }
    if (record.copyAsked === true) out.copyAsked = true;
    return out;
  } catch {
    return {};
  }
}

export async function readEditionDisk(userData: string): Promise<EditionDisk> {
  try {
    return parseEditionDisk(await readFile(join(userData, FILE), 'utf8'));
  } catch {
    return {};
  }
}

export async function readReservations(userData: string): Promise<Reservations> {
  const disk = await readEditionDisk(userData);
  const out: Reservations = {};
  for (const key of KEYS) {
    if (disk[key] === true) out[key] = true;
  }
  return out;
}

async function writeEditionDisk(userData: string, file: EditionDisk): Promise<void> {
  await mkdir(userData, { recursive: true });
  const path = join(userData, FILE);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

export async function writeReservations(userData: string, file: Reservations): Promise<void> {
  const disk = await readEditionDisk(userData);
  await writeEditionDisk(userData, { ...disk, ...file });
}

export async function markCopyAsked(userData: string): Promise<void> {
  const disk = await readEditionDisk(userData);
  disk.copyAsked = true;
  await writeEditionDisk(userData, disk);
}
