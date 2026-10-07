import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocalLearningExample } from '@jarvis/core';

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
}
