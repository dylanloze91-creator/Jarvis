import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  PROJECT_ID_PATTERN,
  JARVIS_PROJECT_ID,
  emptyRegistry,
  projectEntrySchema,
  projectMemorySchema,
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

  /** Entrées d'une autre version de Jarvis, illisibles ici : gardées telles quelles à la réécriture. */
  private foreign: unknown[] = [];

  async registry(): Promise<ProjectRegistry> {
    await this.queue;
    this.foreign = [];
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.registryPath(), 'utf8'));
    } catch {
      return emptyRegistry();
    }
    const entries = (raw as { projects?: unknown })?.projects;
    if (!Array.isArray(entries)) return emptyRegistry();
    const projects: ProjectEntry[] = [];
    for (const entry of entries) {
      const parsed = projectEntrySchema.safeParse(entry);
      if (parsed.success) projects.push(parsed.data);
      else this.foreign.push(entry);
    }
    return { version: 1, projects };
  }

  private saveRegistry(registry: ProjectRegistry): Promise<void> {
    return this.write(this.registryPath(), {
      version: 1,
      projects: [...registry.projects, ...this.foreign],
    });
  }

  async list(): Promise<ProjectEntry[]> {
    return (await this.registry()).projects;
  }

  async add(entry: ProjectEntry): Promise<void> {
    const registry = await this.registry();
    if (registry.projects.some((p) => p.id === entry.id))
      throw new Error(`Projet déjà enregistré : ${entry.id}`);
    registry.projects.push(projectEntrySchema.parse(entry));
    await this.saveRegistry(registry);
  }

  /** Retire le projet de la liste ; son dossier et ses missions restent sur le disque. */
  async remove(id: string): Promise<boolean> {
    const registry = await this.registry();
    const kept = registry.projects.filter((p) => p.id !== id);
    if (kept.length === registry.projects.length) return false;
    await this.saveRegistry({ ...registry, projects: kept });
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

  private chatPath(id: string): string {
    if (id !== JARVIS_PROJECT_ID && !PROJECT_ID_PATTERN.test(id))
      throw new Error(`Projet invalide : ${id}`);
    return join(this.root(), id, 'chat.json');
  }

  async loadChat(
    id: string,
  ): Promise<Array<{ id: string; role: 'user' | 'assistant'; content: string; at: number }>> {
    await this.queue;
    try {
      const raw = JSON.parse(await readFile(this.chatPath(id), 'utf8')) as {
        messages?: unknown;
      };
      if (!Array.isArray(raw.messages)) return [];
      return raw.messages
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const row = entry as Record<string, unknown>;
          const role = row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : null;
          const content = typeof row.content === 'string' ? row.content.slice(0, 8_000) : '';
          const id = typeof row.id === 'string' ? row.id.slice(0, 40) : '';
          const at = typeof row.at === 'number' ? row.at : 0;
          if (!role || !content || !id) return null;
          return { id, role: role as 'user' | 'assistant', content, at };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .slice(-80);
    } catch {
      return [];
    }
  }

  async saveChat(
    id: string,
    messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; at: number }>,
  ): Promise<void> {
    await this.write(this.chatPath(id), { version: 1, messages: messages.slice(-80) });
  }
}
