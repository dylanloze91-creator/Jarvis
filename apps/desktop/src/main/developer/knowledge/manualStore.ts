import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEVELOPER_MANUAL_SEED,
  chunkMarkdownFile,
  formatManualBlock,
  retrieveManualPassages,
  retrieveManualPassagesAsync,
  toManualPassageViews,
  resolveLocalOllamaBase,
  type ManualIndex,
  type ManualPassageView,
  type ManualQuery,
  type ProjectTemplateId,
  type Settings,
  MANUAL_INDEX_VERSION,
} from '@jarvis/core';

const EMBED_MODEL = 'nomic-embed-text';
const INDEX_FILE = 'index.json';

export interface ManualPrepareInput {
  request: string;
  templateId?: ProjectTemplateId;
  failures?: readonly string[];
  settings: Settings;
  installedModels: readonly string[];
}

export interface ManualPrepareResult {
  block: string;
  passages: ManualPassageView[];
}

export interface DeveloperManualStoreOptions {
  userDataPath: () => string;
  fetchImpl?: typeof fetch;
}

export class DeveloperManualStore {
  private index: ManualIndex | null = null;

  constructor(private readonly options: DeveloperManualStoreOptions) {}

  private root(): string {
    return join(this.options.userDataPath(), 'developer', 'knowledge');
  }

  private manualDir(): string {
    return join(this.root(), 'manual');
  }

  private indexPath(): string {
    return join(this.root(), INDEX_FILE);
  }

  private get fetch(): typeof fetch {
    return this.options.fetchImpl ?? globalThis.fetch;
  }

  async ensureSeed(): Promise<void> {
    const dir = this.manualDir();
    await mkdir(dir, { recursive: true });
    const existing = await readdir(dir).catch(() => [] as string[]);
    if (existing.some((f) => f.endsWith('.md'))) return;
    for (const [name, content] of Object.entries(DEVELOPER_MANUAL_SEED)) {
      await writeFile(join(dir, name), content, { encoding: 'utf8', mode: 0o600 });
    }
  }

  async rebuildIndex(settings: Settings, installedModels: readonly string[]): Promise<void> {
    await this.ensureSeed();
    const files = (await readdir(this.manualDir())).filter((f) => f.endsWith('.md'));
    const flat = [];
    for (const file of files) {
      const text = await readFile(join(this.manualDir(), file), 'utf8');
      flat.push(...chunkMarkdownFile(file, text));
    }
    const embed = this.embedFn(settings, installedModels);
    if (embed) {
      for (const chunk of flat) {
        chunk.embedding = (await embed(`${chunk.section}\n${chunk.text}`).catch(() => null)) ?? undefined;
      }
    }
    this.index = { version: MANUAL_INDEX_VERSION, chunks: flat };
    await this.saveIndex();
  }

  private async loadIndex(): Promise<ManualIndex> {
    if (this.index) return this.index;
    try {
      const raw = JSON.parse(await readFile(this.indexPath(), 'utf8')) as ManualIndex;
      if (raw?.version === MANUAL_INDEX_VERSION && Array.isArray(raw.chunks)) {
        this.index = raw;
        return raw;
      }
    } catch {
      /* premier lancement */
    }
    return { version: MANUAL_INDEX_VERSION, chunks: [] };
  }

  private async saveIndex(): Promise<void> {
    const snapshot = JSON.stringify(this.index ?? { version: MANUAL_INDEX_VERSION, chunks: [] });
    await mkdir(this.root(), { recursive: true });
    const tmp = `${this.indexPath()}.tmp`;
    await writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.indexPath());
  }

  private embedFn(settings: Settings, installedModels: readonly string[]) {
    if (!installedModels.some((m) => m === EMBED_MODEL || m.startsWith(`${EMBED_MODEL}:`))) {
      return null;
    }
    const base = resolveLocalOllamaBase(settings);
    return async (text: string): Promise<number[] | null> => {
      const body = { model: EMBED_MODEL, input: text.slice(0, 8000) };
      const modern = await this.fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null);
      if (modern?.ok) {
        const data = (await modern.json()) as { embeddings?: number[][] };
        const vector = data.embeddings?.[0];
        if (Array.isArray(vector) && vector.length >= 16) return vector;
      }
      const legacy = await this.fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }),
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null);
      if (!legacy?.ok) return null;
      const data = (await legacy.json()) as { embedding?: number[] };
      return Array.isArray(data.embedding) && data.embedding.length >= 16 ? data.embedding : null;
    };
  }

  async prepare(input: ManualPrepareInput): Promise<ManualPrepareResult> {
    if (input.settings.developer.knowledgeManual === false) {
      return { block: '', passages: [] };
    }
    let index = await this.loadIndex();
    if (!index.chunks.length) {
      await this.rebuildIndex(input.settings, input.installedModels);
      index = await this.loadIndex();
    }
    const query: ManualQuery = {
      text: input.request,
      templateId: input.templateId,
      failures: input.failures,
    };
    const embed = this.embedFn(input.settings, input.installedModels);
    const passages = embed
      ? await retrieveManualPassagesAsync(index, query, embed)
      : retrieveManualPassages(index, query);
    const block = formatManualBlock(passages);
    return { block, passages: toManualPassageViews(passages) };
  }
}
