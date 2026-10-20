import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { examplesToJsonl, type LocalLearningExample } from '@jarvis/core';

const FILE = 'learning/examples.json';

export class LocalLearningStore {
  constructor(private readonly userData: () => string) {}

  private path(): string {
    return join(this.userData(), FILE);
  }

  async list(): Promise<LocalLearningExample[]> {
    try {
      const raw = await readFile(this.path(), 'utf8');
      const data = JSON.parse(raw) as LocalLearningExample[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async append(example: LocalLearningExample): Promise<LocalLearningExample[]> {
    const dir = join(this.userData(), 'learning');
    await mkdir(dir, { recursive: true });
    const all = await this.list();
    all.push(example);
    await writeFile(this.path(), JSON.stringify(all, null, 2), 'utf8');
    return all;
  }

  workDir(): string {
    return join(this.userData(), 'learning', 'workspace');
  }

  adapterDir(): string {
    return join(this.userData(), 'learning', 'adapter');
  }

  jsonlPath(): string {
    return join(this.workDir(), 'train.jsonl');
  }

  currentAdapterDir(): string {
    return join(this.workDir(), 'adapter');
  }

  previousAdapterDir(): string {
    return join(this.userData(), 'learning', 'adapter-previous');
  }

  /** Écrit le jeu d’entraînement et le jeu de validation, séparés. */
  async writeSplit(
    train: readonly { id?: string; user: string; assistant: string; correction?: string }[],
    validation: readonly { id?: string; user: string; assistant: string; correction?: string }[],
  ): Promise<void> {
    const asExample = (
      row: { id?: string; user: string; assistant: string; correction?: string },
      index: number,
    ): LocalLearningExample => ({
      id: row.id ?? `row-${index}`,
      at: Date.now(),
      user: row.user,
      assistant: row.assistant,
      ...(row.correction ? { correction: row.correction } : {}),
      toolsOk: [],
      conversationId: '',
    });
    await mkdir(this.workDir(), { recursive: true });
    await writeFile(this.jsonlPath(), examplesToJsonl(train.map(asExample)), 'utf8');
    await writeFile(join(this.workDir(), 'valid.jsonl'), examplesToJsonl(validation.map(asExample)), 'utf8');
  }

  /** Copie l’adaptateur courant avant un nouvel entraînement. */
  async archiveAdapter(): Promise<boolean> {
    if (!(await exists(this.currentAdapterDir()))) return false;
    const previous = this.previousAdapterDir();
    await rm(previous, { recursive: true, force: true });
    await mkdir(join(this.userData(), 'learning'), { recursive: true });
    await cp(this.currentAdapterDir(), previous, { recursive: true });
    return true;
  }

  /** Remet l’adaptateur archivé à la place du dernier essai. */
  async restoreAdapter(): Promise<boolean> {
    if (!(await exists(this.previousAdapterDir()))) return false;
    await rm(this.currentAdapterDir(), { recursive: true, force: true });
    await mkdir(this.workDir(), { recursive: true });
    await cp(this.previousAdapterDir(), this.currentAdapterDir(), { recursive: true });
    return true;
  }

  /** Échange l’adaptateur courant et le précédent (retour arrière). */
  async swapAdapters(): Promise<boolean> {
    const current = this.currentAdapterDir();
    const previous = this.previousAdapterDir();
    const hasCurrent = await exists(current);
    const hasPrevious = await exists(previous);
    if (!hasPrevious) return false;
    const tmp = join(this.userData(), 'learning', 'adapter-swap');
    await rm(tmp, { recursive: true, force: true });
    if (hasCurrent) await rename(current, tmp);
    await mkdir(this.workDir(), { recursive: true });
    await rename(previous, current);
    if (hasCurrent) {
      await mkdir(join(this.userData(), 'learning'), { recursive: true });
      await rename(tmp, previous);
    }
    return true;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
