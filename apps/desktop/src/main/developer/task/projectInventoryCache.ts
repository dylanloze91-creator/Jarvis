import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectProjectInventory,
  formatProjectInventoryBlock,
  type ProjectInventory,
} from '@jarvis/core';

type CacheEntry = { signature: string; inventory: ProjectInventory; block: string };

const cache = new Map<string, CacheEntry>();
const bump = new Map<string, number>();

const WATCH_FILES = [
  'package.json',
  'tsconfig.json',
  'App.csproj',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pnpm-lock.yaml',
  'package-lock.json',
] as const;

function fileSignature(root: string): string {
  const parts: string[] = [`bump:${bump.get(root) ?? 0}`];
  for (const rel of WATCH_FILES) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    try {
      const st = statSync(path);
      parts.push(`${rel}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${rel}:missing`);
    }
  }
  return parts.join('|');
}

function readInventory(root: string): ProjectInventory {
  return detectProjectInventory({
    exists: (rel) => existsSync(join(root, rel)),
    readUtf8: (rel) => {
      try {
        return readFileSync(join(root, rel), 'utf8');
      } catch {
        return null;
      }
    },
  });
}

/** Invalide le cache après une écriture dans la copie isolée (ou le dépôt). */
export function invalidateProjectInventory(root: string): void {
  bump.set(root, (bump.get(root) ?? 0) + 1);
  cache.delete(root);
}

/** Bloc inventaire pour le prompt de plan, mis en cache tant que la signature ne change pas. */
export function projectInventoryContext(root: string): string {
  const signature = fileSignature(root);
  const hit = cache.get(root);
  if (hit && hit.signature === signature) return hit.block;
  const inventory = readInventory(root);
  const block = formatProjectInventoryBlock(inventory);
  cache.set(root, { signature, inventory, block });
  return block;
}
