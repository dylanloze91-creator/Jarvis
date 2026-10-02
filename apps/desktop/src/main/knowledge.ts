import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile, rename } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { resolveLocalOllamaBase, type KnowledgeStats, type Settings } from '@jarvis/core';

export interface KnowledgeChunk {
  id: string;
  source: string;
  title: string;
  text: string;
  kind: 'file' | 'conversation' | 'memory';
  updatedAt: number;
  embedding?: number[];
}

interface KnowledgeIndex {
  version: 1;
  chunks: KnowledgeChunk[];
}

export interface KnowledgeStoreOptions {
  getUserDataPath: () => string;
  fetchImpl?: typeof fetch;
}

const FILE = 'knowledge-index.json';
const EMBED_MODEL = 'nomic-embed-text';
const MAX_FILE_BYTES = 2_000_000;
const CHUNK_CHARS = 2200;
const OVERLAP = 250;
const MAX_FILES = 200;
const MAX_WALK_DEPTH = 8;
const MAX_CHUNKS = 4_000;
const MAX_CONVERSATION_CHARS = 40_000;
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.yaml',
  '.yml',
  '.xml',
  '.log',
  '.ini',
  '.toml',
  '.sql',
  '.pdf',
]);

export type MemorySection = 'profile' | 'preferences' | 'projects' | 'conversations';

export const MEMORY_SECTIONS: MemorySection[] = [
  'profile',
  'preferences',
  'projects',
  'conversations',
];

const BLOCKED_FOLDER_NAMES = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'system32',
  'syswow64',
  '$recycle.bin',
  'etc',
  'usr',
  'bin',
  'sbin',
  'sys',
  'proc',
  'dev',
  'root',
]);

export class KnowledgeStore {
  private index: KnowledgeIndex | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: KnowledgeStoreOptions) {}

  private get fetch(): typeof fetch {
    return this.options.fetchImpl ?? globalThis.fetch;
  }

  private indexPath(): string {
    return join(this.options.getUserDataPath(), FILE);
  }

  async load(): Promise<KnowledgeIndex> {
    if (this.index) return this.index;
    try {
      const raw = await readFile(this.indexPath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<KnowledgeIndex>;
      this.index = {
        version: 1,
        chunks: Array.isArray(parsed.chunks) ? parsed.chunks.filter(validChunk) : [],
      };
    } catch {
      this.index = { version: 1, chunks: [] };
    }
    return this.index;
  }

  async search(
    query: string,
    settings: Settings,
    limit = 6,
    kind?: KnowledgeChunk['kind'],
  ): Promise<KnowledgeChunk[]> {
    const index = await this.load();
    const q = query.trim();
    if (!q) return [];

    const embedding = await this.embed(q, settings).catch(() => null);
    const terms = tokenize(q);
    const pool = kind ? index.chunks.filter((chunk) => chunk.kind === kind) : index.chunks;
    const scored = pool.map((chunk) => {
      const lexical = lexicalScore(terms, `${chunk.title} ${chunk.text}`);
      const semantic = embedding && chunk.embedding ? cosine(embedding, chunk.embedding) : 0;
      const score = embedding ? semantic * 0.78 + lexical * 0.22 : lexical;
      return { chunk, score };
    });

    return scored
      .filter((item) => item.score > (embedding ? 0.18 : 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 8)))
      .map((item) => item.chunk);
  }

  async searchDocuments(query: string, settings: Settings, limit = 6): Promise<KnowledgeChunk[]> {
    return this.search(query, settings, limit, 'file');
  }

  async readDocument(source: string): Promise<string> {
    const index = await this.load();
    const needle = source.trim();
    if (!needle) return '';
    const chunks = index.chunks.filter(
      (chunk) => chunk.kind === 'file' && (chunk.source === needle || chunk.title === needle),
    );
    return chunks
      .map((chunk) => chunk.text)
      .join('\n\n')
      .slice(0, 8_000);
  }

  async remember(
    text: string,
    settings: Settings,
    title = 'Mémoire Jarvis',
    section: MemorySection = 'projects',
  ): Promise<KnowledgeChunk> {
    const normalized = text.trim();
    if (!normalized) throw new Error('La mémoire à enregistrer est vide.');
    const chunk: KnowledgeChunk = {
      id: hash(`memory:${title}:${normalized}`),
      source: 'jarvis-memory',
      title,
      text: normalized.slice(0, 8_000),
      kind: 'memory',
      updatedAt: Date.now(),
    };
    chunk.embedding = (await this.embed(chunk.text, settings).catch(() => null)) ?? undefined;
    const index = await this.load();
    index.chunks = [chunk, ...index.chunks.filter((item) => item.id !== chunk.id)];
    capIndex(index);
    await this.save();
    await this.appendMemorySection(section, { title, text: chunk.text, updatedAt: chunk.updatedAt });
    return chunk;
  }

  async indexFolder(
    folder: string,
    settings: Settings,
  ): Promise<{ files: number; chunks: number }> {
    const root = await assertIndexableFolder(folder);
    const files = await collectFiles(root);
    let count = 0;
    for (const file of files) {
      count += await this.indexFile(file, settings);
    }
    await this.save();
    await this.writeDocumentManifest(files);
    return { files: files.length, chunks: count };
  }

  async indexConversation(source: string, text: string, settings: Settings): Promise<number> {
    const clipped = text.trim().slice(0, MAX_CONVERSATION_CHARS);
    if (!clipped) return 0;
    const chunks = splitText(clipped);
    const index = await this.load();
    index.chunks = index.chunks.filter((item) => item.source !== source);
    for (const [i, part] of chunks.entries()) {
      const chunk: KnowledgeChunk = {
        id: hash(`${source}:${i}:${part}`),
        source,
        title: 'Conversation Jarvis',
        text: part,
        kind: 'conversation',
        updatedAt: Date.now(),
      };
      chunk.embedding = (await this.embed(part, settings).catch(() => null)) ?? undefined;
      index.chunks.push(chunk);
    }
    capIndex(index);
    await this.save();
    return chunks.length;
  }

  async clear(): Promise<void> {
    this.index = { version: 1, chunks: [] };
    await this.save();
  }

  async stats(): Promise<KnowledgeStats> {
    const index = await this.load();
    return {
      chunks: index.chunks.length,
      sources: new Set(index.chunks.map((item) => item.source)).size,
      embedded: index.chunks.filter((item) => item.embedding?.length).length,
    };
  }

  private async indexFile(file: string, settings: Settings): Promise<number> {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return 0;
    const ext = extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) return 0;
    const text =
      ext === '.pdf' ? extractPdfText(await readFile(file)) : await this.readUtf8Document(file);
    if (!text.trim()) return 0;
    const parts = splitText(text);
    const index = await this.load();
    index.chunks = index.chunks.filter((item) => item.source !== file);
    for (const [i, part] of parts.entries()) {
      const chunk: KnowledgeChunk = {
        id: hash(`${file}:${info.mtimeMs}:${i}:${part}`),
        source: file,
        title: file.split(/[\\/]/).pop() || file,
        text: part,
        kind: 'file',
        updatedAt: info.mtimeMs,
      };
      chunk.embedding = (await this.embed(part, settings).catch(() => null)) ?? undefined;
      index.chunks.push(chunk);
    }
    capIndex(index);
    return parts.length;
  }

  private async readUtf8Document(file: string): Promise<string> {
    const raw = await readFile(file, 'utf8').catch(() => '');
    if (!raw.trim() || raw.includes('\0')) return '';
    return normalizeText(raw, file);
  }

  private memoryRoot(): string {
    return join(this.options.getUserDataPath(), 'memory');
  }

  private async appendMemorySection(
    section: MemorySection,
    entry: { title: string; text: string; updatedAt: number },
  ): Promise<void> {
    const dir = this.memoryRoot();
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${section}.json`);
    const current = await readJsonArray(path);
    const next = [
      entry,
      ...current.filter(
        (item) =>
          !(
            item &&
            typeof item === 'object' &&
            (item as { title?: string; text?: string }).title === entry.title &&
            (item as { text?: string }).text === entry.text
          ),
      ),
    ].slice(0, 200);
    await writeFile(path, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
  }

  private async writeDocumentManifest(files: string[]): Promise<void> {
    const dir = join(this.options.getUserDataPath(), 'knowledge');
    await mkdir(dir, { recursive: true });
    await mkdir(join(this.options.getUserDataPath(), 'index'), { recursive: true });
    await writeFile(join(dir, 'documents.json'), JSON.stringify({ files }, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  private async embed(text: string, settings: Settings): Promise<number[]> {
    const base = resolveLocalOllamaBase(settings);
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
    });
    if (!legacy.ok) throw new Error(`Ollama embeddings HTTP ${legacy.status}`);
    const data = (await legacy.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length < 16) {
      throw new Error('Embedding invalide.');
    }
    return data.embedding;
  }

  private async save(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const snapshot = JSON.stringify(this.index ?? { version: 1, chunks: [] });
      await mkdir(this.options.getUserDataPath(), { recursive: true });
      const tmp = `${this.indexPath()}.tmp`;
      await writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, this.indexPath());
    });
    await this.writeQueue;
  }
}

export async function assertIndexableFolder(folder: string): Promise<string> {
  const trimmed = folder.trim();
  if (!trimmed) throw new Error('Le chemin du dossier est vide.');
  if (!isAbsolutePath(trimmed)) {
    throw new Error('Le dossier à indexer doit être un chemin absolu.');
  }
  if (isBlockedFolder(trimmed)) {
    throw new Error('Ce dossier système ne peut pas être indexé.');
  }
  const root = isAbsolute(trimmed) ? resolve(trimmed) : trimmed;
  if (isBlockedFolder(root)) {
    throw new Error('Ce dossier système ne peut pas être indexé.');
  }
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Dossier introuvable : ${root}`);
  }
  return root;
}

function isAbsolutePath(value: string): boolean {
  return isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value);
}

function isBlockedFolder(folder: string): boolean {
  const parts = folder.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.length === 1 && /^[a-zA-Z]:$/.test(parts[0] ?? '')) return true;
  return parts.some((part) => BLOCKED_FOLDER_NAMES.has(part.toLowerCase()));
}

function validChunk(value: unknown): value is KnowledgeChunk {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<KnowledgeChunk>;
  return (
    typeof item.id === 'string' &&
    typeof item.source === 'string' &&
    typeof item.text === 'string' &&
    typeof item.title === 'string' &&
    (item.kind === 'file' || item.kind === 'conversation' || item.kind === 'memory')
  );
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH || out.length >= MAX_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (rel.startsWith('..') || (rel && isAbsolute(rel))) continue;
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(full);
    }
  }
  await walk(root, 0);
  return out;
}

function splitText(text: string): string[] {
  const clean = text.replace(/\r/g, '').trim();
  if (!clean) return [];
  const result: string[] = [];
  for (let start = 0; start < clean.length; start += CHUNK_CHARS - OVERLAP) {
    const part = clean.slice(start, start + CHUNK_CHARS).trim();
    if (part) result.push(part);
    if (start + CHUNK_CHARS >= clean.length) break;
  }
  return result;
}

function normalizeText(text: string, file: string): string {
  if (/\.html?$/i.test(file)) {
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  return text;
}

function tokenize(text: string): string[] {
  return (
    text
      .toLocaleLowerCase('fr-FR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[\p{L}\p{N}]{2,}/gu) ?? []
  );
}

function lexicalScore(terms: string[], text: string): number {
  const tokens = new Set(tokenize(text));
  if (!terms.length) return 0;
  return terms.reduce((score, term) => score + (tokens.has(term) ? 1 : 0), 0) / terms.length;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    aa += av ** 2;
    bb += bv ** 2;
  }
  return aa && bb ? Math.max(0, dot / Math.sqrt(aa * bb)) : 0;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const parts: string[] = [];
  const pattern = /\((?:\\.|[^\\)]){2,}\)\s*Tj/g;
  for (const match of raw.matchAll(pattern)) {
    const inner = match[0].replace(/\)\s*Tj$/, '').slice(1);
    const text = inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\([()\\])/g, '$1')
      // eslint-disable-next-line no-control-regex -- garde tabulation et retours à la ligne, efface les autres octets.
      .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 2) parts.push(text);
  }
  return parts.join('\n').slice(0, 200_000);
}

async function readJsonArray(path: string): Promise<unknown[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function capIndex(index: KnowledgeIndex): void {
  if (index.chunks.length <= MAX_CHUNKS) return;
  const memories = index.chunks.filter((item) => item.kind === 'memory');
  const rest = index.chunks
    .filter((item) => item.kind !== 'memory')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const budget = Math.max(0, MAX_CHUNKS - memories.length);
  index.chunks = [...memories, ...rest.slice(0, budget)];
}
