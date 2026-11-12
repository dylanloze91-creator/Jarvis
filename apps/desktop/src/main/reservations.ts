import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Reservations, type ReservedFunction } from '@jarvis/core';

const FILE = 'edition.json';
const KEYS: readonly ReservedFunction[] = ['wakeWord', 'speaker', 'phone', 'shortcut'];

/** Lecture seule. Fichier absent ou illisible : rien n'est activé. */
export function parseReservations(raw: string): Reservations {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    const out: Reservations = {};
    for (const key of KEYS) {
      if (record[key] === true) out[key] = true;
    }
    return out;
  } catch {
    return {};
  }
}

export async function readReservations(userData: string): Promise<Reservations> {
  try {
    return parseReservations(await readFile(join(userData, FILE), 'utf8'));
  } catch {
    return {};
  }
}

export async function writeReservations(userData: string, file: Reservations): Promise<void> {
  await mkdir(userData, { recursive: true });
  const path = join(userData, FILE);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}
