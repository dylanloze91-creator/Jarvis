/**
 * Écriture de `userData/carnet/rates.jsonl`. Le dossier est celui de l'application,
 * jamais le dépôt.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendRate, parseRates, serializeRates, type RateEntry } from '@jarvis/core';

export class CarnetFile {
  constructor(private readonly userData: () => string) {}

  directory(): string {
    return join(this.userData(), 'carnet');
  }

  ratesFile(): string {
    return join(this.directory(), 'rates.jsonl');
  }

  async readJson(name: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(join(this.directory(), name), 'utf8')) as unknown;
    } catch {
      return null;
    }
  }

  async writeJson(name: string, value: unknown): Promise<void> {
    const dir = this.directory();
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tmp, path);
  }

  async read(): Promise<RateEntry[]> {
    try {
      return parseRates(await readFile(this.ratesFile(), 'utf8'));
    } catch {
      return [];
    }
  }

  async write(entries: readonly RateEntry[]): Promise<void> {
    const dir = this.directory();
    await mkdir(dir, { recursive: true });
    const path = this.ratesFile();
    const tmp = `${path}.tmp`;
    await writeFile(tmp, serializeRates(entries), 'utf8');
    await rename(tmp, path);
  }

  async append(entry: RateEntry): Promise<void> {
    await this.write(appendRate(await this.read(), entry));
  }
}
