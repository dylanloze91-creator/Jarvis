import { join } from 'node:path';
import { z } from 'zod';
import {
  APPENDICE_GENRES,
  APPENDICE_LINKS,
  APPENDICE_MAX,
  APPENDICE_RISKS,
  appendiceCapacitySchema,
  type AppendiceCapacity,
  type AppendiceGenre,
  type AppendiceLink,
  type AppendiceRisk,
} from '@jarvis/core';
import { readStateFile, writeStateFile } from '../safeFile.js';

/**
 * Registre des appendices, dans `userData/appendices.json` : hors de `settings.json`, comme les
 * enceintes (un brouillon de réglages ne peut pas effacer un appendice, `parseSettings({})` ne
 * gagne aucune clé). Écriture sûre (`safeFile.ts`).
 *
 * Le jeton n'est jamais écrit en clair : `tokenSealed` est chiffré par le système (`safeStorage`).
 * Sans chiffrement, le jeton reste en mémoire et il faut le redonner après un redémarrage.
 */
export interface AppendiceRecord {
  id: string;
  genre: AppendiceGenre;
  nom: string;
  piece?: string;
  lien: AppendiceLink;
  risque: AppendiceRisk;
  capacites: AppendiceCapacity[];
  version: string;
  baseUrl: string;
  tokenSealed?: string;
  addedAt: number;
}

interface AppendiceFile {
  enabled: boolean;
  appendices: AppendiceRecord[];
}

const recordSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
  genre: z.enum(APPENDICE_GENRES),
  nom: z.string().min(1).max(40),
  piece: z.string().max(40).optional(),
  lien: z.enum(APPENDICE_LINKS),
  risque: z.enum(APPENDICE_RISKS),
  capacites: z.array(appendiceCapacitySchema).max(24),
  version: z.string().min(1).max(24),
  baseUrl: z.string().min(1).max(200),
  tokenSealed: z.string().max(4096).optional(),
  addedAt: z.number(),
});

/** Une entrée illisible est écartée ; le reste du registre est gardé. */
function parseAppendiceFile(bytes: Buffer): AppendiceFile {
  const raw: unknown = JSON.parse(bytes.toString('utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('appendices.json : objet attendu');
  const data = raw as { enabled?: unknown; appendices?: unknown };
  const seen = new Set<string>();
  const appendices: AppendiceRecord[] = [];
  for (const entry of Array.isArray(data.appendices) ? data.appendices : []) {
    const parsed = recordSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id) || appendices.length >= APPENDICE_MAX) continue;
    seen.add(parsed.data.id);
    appendices.push(parsed.data);
  }
  return { enabled: data.enabled === true, appendices };
}

export class AppendiceStore {
  private state: AppendiceFile = { enabled: false, appendices: [] };
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: () => string) {}

  static inUserData(userData: () => string): AppendiceStore {
    return new AppendiceStore(() => join(userData(), 'appendices.json'));
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.state = { enabled: false, appendices: [] };
    const read = await readStateFile(this.filePath(), parseAppendiceFile).catch(() => null);
    if (read && (read.status === 'ok' || read.status === 'restored')) this.state = read.value;
    this.loaded = true;
  }

  get enabled(): boolean {
    return this.state.enabled;
  }

  records(): AppendiceRecord[] {
    return this.state.appendices.map((record) => ({ ...record, capacites: record.capacites.map((capacity) => ({ ...capacity })) }));
  }

  find(id: string): AppendiceRecord | null {
    return this.records().find((record) => record.id === id) ?? null;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.load();
    if (this.state.enabled === enabled) return;
    this.state = { ...this.state, enabled };
    await this.save();
  }

  /** Ajoute ou remplace (même identifiant). Rend `false` si le registre est plein. */
  async put(record: AppendiceRecord): Promise<boolean> {
    await this.load();
    const others = this.state.appendices.filter((item) => item.id !== record.id);
    if (others.length >= APPENDICE_MAX) return false;
    this.state = { ...this.state, appendices: [...others, record] };
    await this.save();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    await this.load();
    const kept = this.state.appendices.filter((item) => item.id !== id);
    if (kept.length === this.state.appendices.length) return false;
    this.state = { ...this.state, appendices: kept };
    await this.save();
    return true;
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await writeStateFile(this.filePath(), snapshot, { mode: 0o600, parse: parseAppendiceFile });
      });
    return this.writing;
  }
}
