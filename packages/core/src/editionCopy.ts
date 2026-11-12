import { TEST_EDITION } from './edition.js';

/** Chemins relatifs seulement, sans `node:path` (ce module est tiré par la fenêtre). */
function joinPath(...parts: string[]): string {
  const segments: string[] = [];
  for (const part of parts) {
    for (const bit of part.split(/[\\/]/)) {
      if (!bit || bit === '.') continue;
      if (bit === '..') segments.pop();
      else segments.push(bit);
    }
  }
  return segments.join('/');
}

function pathIsInside(root: string, target: string): boolean {
  const left = root.split(/[\\/]/).filter(Boolean);
  const right = target.split(/[\\/]/).filter(Boolean);
  if (right.length < left.length) return false;
  return left.every((segment, index) => segment === right[index]);
}

/**
 * Recopie du dossier de Jarvis Live vers Jarvis Test.
 * Live est lu, jamais écrit. L'historique, le journal et l'apprentissage
 * ne font pas partie de la liste.
 */

export const LIVE_COPY_FILES = [
  'settings.json',
  'personalization.json',
  'questionnaire.json',
  'knowledge-index.json',
  'developer/code-model.json',
] as const;

export const LIVE_COPY_DIRS = ['memory', 'developer/projects'] as const;

export const RECONNECT_GUIDE =
  'Les clés de Jarvis Live restent chiffrées pour lui. Ici, reconnecte seulement ce dont tu as besoin : Spotify, Google, et les clés API dans Réglages.';

const SECRET_FILES = ['coffre.bin', 'google-token.bin'] as const;

export interface CopyHost {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Entrées directes du dossier. Un dossier absent lève. */
  readdir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
}

export interface SecretCipher {
  /** `null` si ce processus ne peut pas lire le coffre. Le clair ne doit pas être journalisé. */
  tryDecrypt(bytes: Uint8Array): string | null;
}

export interface CopyReport {
  copied: string[];
  missing: string[];
  /** `reconnect` : un coffre était là, mais illisible. */
  secrets: 'imported' | 'reconnect';
  reconnect: string[];
  guide: string | null;
}

function child(root: string, rel: string): string {
  const parts = rel.split(/[\\/]/).filter((part) => part.length > 0);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('chemin refusé');
  }
  const target = joinPath(root, ...parts);
  if (!pathIsInside(root, target)) throw new Error('chemin refusé');
  return target;
}

function assertTestWrite(liveRoot: string, testRoot: string, target: string): void {
  if (!pathIsInside(testRoot, target) || pathIsInside(liveRoot, target)) {
    throw new Error('écriture refusée dans le dossier de Jarvis Live');
  }
}

/** Retire les blocs d'apprentissage. Le reste de l'index (souvenirs, documents) reste. */
export function knowledgeIndexWithoutLearning(raw: string): string {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !Array.isArray((value as { chunks?: unknown }).chunks)) return raw;
  const index = value as { chunks: Array<{ learning?: unknown; source?: unknown }> };
  index.chunks = index.chunks.filter((chunk) => {
    if (chunk?.learning) return false;
    return !(typeof chunk?.source === 'string' && chunk.source.startsWith('learning:'));
  });
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** La copie de Test ne reprend pas le raccourci de Live. */
export function settingsForTestCopy(raw: string): string {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return raw;
  (value as { hotkey?: string }).hotkey = TEST_EDITION.shortcut;
  return `${JSON.stringify(value, null, 2)}\n`;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function readOptional(host: CopyHost, path: string): Promise<Uint8Array | null> {
  try {
    return await host.readFile(path);
  } catch {
    return null;
  }
}

async function writeTest(
  liveRoot: string,
  testRoot: string,
  host: CopyHost,
  rel: string,
  data: Uint8Array,
): Promise<void> {
  const target = child(testRoot, rel);
  assertTestWrite(liveRoot, testRoot, target);
  await host.mkdir(child(testRoot, rel.split(/[\\/]/).slice(0, -1).join('/')));
  await host.writeFile(target, data);
}

async function copyTree(
  liveRoot: string,
  testRoot: string,
  host: CopyHost,
  rel: string,
  copied: string[],
): Promise<void> {
  const source = child(liveRoot, rel);
  let entries: Array<{ name: string; isDirectory: boolean }>;
  try {
    entries = await host.readdir(source);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory) await copyTree(liveRoot, testRoot, host, next, copied);
    else {
      const bytes = await readOptional(host, child(liveRoot, next));
      if (!bytes) continue;
      await writeTest(liveRoot, testRoot, host, next, bytes);
      copied.push(next);
    }
  }
}

export async function copyLiveIntoTest(input: {
  liveRoot: string;
  testRoot: string;
  host: CopyHost;
  cipher?: SecretCipher;
  log?: (line: string) => void;
}): Promise<CopyReport> {
  const { liveRoot, testRoot, host } = input;
  const log = input.log ?? (() => undefined);
  const copied: string[] = [];
  const missing: string[] = [];

  for (const rel of LIVE_COPY_FILES) {
    const bytes = await readOptional(host, child(liveRoot, rel));
    if (!bytes) {
      missing.push(rel);
      continue;
    }
    let body = bytes;
    if (rel === 'settings.json' || rel === 'knowledge-index.json') {
      try {
        const text = textDecoder.decode(bytes);
        const next = rel === 'settings.json' ? settingsForTestCopy(text) : knowledgeIndexWithoutLearning(text);
        body = textEncoder.encode(next);
      } catch {
        missing.push(rel);
        continue;
      }
    }
    await writeTest(liveRoot, testRoot, host, rel, body);
    copied.push(rel);
    log(`copié : ${rel}`);
  }

  for (const dir of LIVE_COPY_DIRS) {
    await copyTree(liveRoot, testRoot, host, dir, copied);
    log(`copié : ${dir}/`);
  }

  const reconnect: string[] = [];
  for (const name of SECRET_FILES) {
    const bytes = await readOptional(host, child(liveRoot, name));
    if (!bytes) continue;
    const plain = input.cipher?.tryDecrypt(bytes) ?? null;
    if (plain == null) {
      reconnect.push(name);
      log(`illisible : ${name}`);
      continue;
    }
    await writeTest(liveRoot, testRoot, host, name, bytes);
    copied.push(name);
    log(`coffre recopié (toujours chiffré) : ${name}`);
  }

  const spotify = await readOptional(host, child(liveRoot, 'spotify-token.json'));
  if (spotify) {
    await writeTest(liveRoot, testRoot, host, 'spotify-token.json', spotify);
    copied.push('spotify-token.json');
    log('copié : spotify-token.json');
  }

  return {
    copied,
    missing,
    secrets: reconnect.length > 0 ? 'reconnect' : 'imported',
    reconnect,
    guide: reconnect.length > 0 ? RECONNECT_GUIDE : null,
  };
}
