import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  PROJECT_ID_PATTERN,
  JARVIS_PROJECT_ID,
  emptyRegistry,
  projectMemorySchema,
  projectRegistrySchema,
  type ProjectEntry,
  type ProjectMemory,
  type ProjectRegistry,
} from '@jarvis/core';

/**
 * Registre et mémoire des projets, dans les données de Jarvis (décision D3) :
 * `<userData>/developer/projects/registry.json` et
 * `<userData>/developer/projects/<projet>/memory.json`. Rien n'est écrit dans
 * les dépôts des projets.
 */
export class ProjectStore {
  private queue: Promise<void> = Promise.resolve();
  private written = 0;

  constructor(private readonly root: () => string) {}

  private write(path: string, value: unknown): Promise<void> {
    const body = `${JSON.stringify(value, null, 2)}\n`;
    const next = this.queue.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      this.written += 1;
      const temporary = `${path}.${this.written}.tmp`;
      await writeFile(temporary, body);
      await rename(temporary, path);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private registryPath(): string {
    return join(this.root(), 'registry.json');
  }

  async registry(): Promise<ProjectRegistry> {
    await this.queue;
    try {
      const parsed = projectRegistrySchema.safeParse(
        JSON.parse(await readFile(this.registryPath(), 'utf8')),
      );
      return parsed.success ? parsed.data : emptyRegistry();
    } catch {
      return emptyRegistry();
    }
  }

  async list(): Promise<ProjectEntry[]> {
    return (await this.registry()).projects;
  }

  async add(entry: ProjectEntry): Promise<void> {
    const registry = await this.registry();
    if (registry.projects.some((p) => p.id === entry.id))
      throw new Error(`Projet déjà enregistré : ${entry.id}`);
    registry.projects.push(entry);
    await this.write(this.registryPath(), projectRegistrySchema.parse(registry));
  }

  /** Retire le projet de la liste ; son dossier et ses missions restent sur le disque. */
  async remove(id: string): Promise<boolean> {
    const registry = await this.registry();
    const kept = registry.projects.filter((p) => p.id !== id);
    if (kept.length === registry.projects.length) return false;
    await this.write(this.registryPath(), { ...registry, projects: kept });
    return true;
  }

  private memoryPath(id: string): string {
    if (id !== JARVIS_PROJECT_ID && !PROJECT_ID_PATTERN.test(id))
      throw new Error(`Projet invalide : ${id}`);
    return join(this.root(), id, 'memory.json');
  }

  /** Null : jamais enregistrée (la mémoire par défaut s'applique). */
  async memory(id: string): Promise<ProjectMemory | null> {
    await this.queue;
    try {
      const parsed = projectMemorySchema.safeParse(
        JSON.parse(await readFile(this.memoryPath(id), 'utf8')),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async saveMemory(id: string, notes: string, now: number): Promise<ProjectMemory> {
    const memory = projectMemorySchema.parse({ notes, updatedAt: now });
    await this.write(this.memoryPath(id), memory);
    return memory;
  }
}
