import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';

const SEARCH_TIME_BUDGET_MS = 15_000;
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '$Recycle.Bin',
  'System Volume Information',
  'Windows',
  'AppData',
]);

export const searchFilesTool = defineTool({
  name: 'search_files',
  description:
    "Recherche des fichiers par nom (sous-chaîne ou motif avec `*`) à partir d'une racine donnée, sur tout le disque si nécessaire. `maxDepth` et `maxResults` bornent l'exploration pour rester rapide.",
  risk: 'safe',
  schema: z.object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe('Nom ou motif à rechercher, par ex. "rapport*.pdf".'),
    root: z
      .string()
      .max(500)
      .optional()
      .describe("Dossier de départ. Par défaut, le dossier personnel de l'utilisateur."),
    maxDepth: z
      .number()
      .int()
      .min(1)
      .max(24)
      .default(8)
      .describe('Profondeur maximale de sous-dossiers explorés.'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .describe('Nombre maximum de résultats renvoyés.'),
  }),
  execute: async ({ query, root, maxDepth, maxResults }) => {
    const startRoot = root?.trim() || os.homedir();
    const pattern = toMatcher(query);

    const results: string[] = [];
    let scanned = 0;
    let timedOut = false;
    const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;

    async function walk(dir: string, depth: number): Promise<void> {
      if (results.length >= maxResults || timedOut) return;
      if (Date.now() > deadline) {
        timedOut = true;
        return;
      }

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // Permission refusée ou dossier disparu : on ignore et on continue.
      }

      for (const entry of entries) {
        if (results.length >= maxResults || timedOut) return;
        if (Date.now() > deadline) {
          timedOut = true;
          return;
        }

        scanned += 1;
        const full = join(dir, entry.name);

        if (pattern.test(entry.name)) results.push(full);

        if (entry.isDirectory() && depth < maxDepth && !SKIP_DIRECTORIES.has(entry.name)) {
          await walk(full, depth + 1);
        }
      }
    }

    try {
      await walk(startRoot, 0);
    } catch (error) {
      return {
        ok: false,
        content: `Recherche interrompue : ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const header = `${results.length} résultat${results.length === 1 ? '' : 's'} pour « ${query} » sous ${startRoot} (${scanned} éléments parcourus${timedOut ? ', arrêt anticipé : délai dépassé' : ''}).`;

    if (results.length === 0) {
      return { ok: true, content: header, data: { results: [], timedOut } };
    }

    return {
      ok: true,
      content: [header, ...results.map((r) => `- ${r}`)].join('\n'),
      data: { results, timedOut },
    };
  },
});

/** Convertit un motif simple (`*`, `?`) en expression régulière insensible à la casse. */
function toMatcher(query: string): RegExp {
  const hasWildcard = /[*?]/.test(query);
  const escaped = query.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const source = hasWildcard ? `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$` : escaped;
  return new RegExp(source, 'i');
}
