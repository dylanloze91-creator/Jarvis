import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { ToolManager, defineTool, toolSuccess } from '@jarvis/core';
import { fail } from '../tools/common.js';
import { RepoJailError, resolveInRepo } from '../tools/jail.js';

async function listFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, path)));
    else out.push(relative(root, path).split(sep).join('/'));
  }
  return out.sort();
}

async function jailed<T>(action: () => Promise<T>): Promise<T | ReturnType<typeof fail>> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof RepoJailError) return fail('definitive', error.message);
    return fail('recoverable', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Outils du banc, limités à un dossier jetable (jamais la copie de travail).
 * `edit_file` exige un texte exact et unique, puis relit le fichier.
 */
export function createBenchTools(sandbox: string): ToolManager {
  return new ToolManager().registerAll([
    defineTool({
      name: 'list_files',
      description: 'Liste les fichiers du projet.',
      risk: 'safe',
      schema: z.object({}),
      execute: async () => toolSuccess((await listFiles(sandbox)).join('\n')),
    }),
    defineTool({
      name: 'read_file',
      description: 'Lit un fichier du projet (chemin relatif).',
      risk: 'safe',
      schema: z.object({ path: z.string().min(1).max(200) }),
      execute: ({ path }) =>
        jailed(async () =>
          toolSuccess(await readFile((await resolveInRepo(sandbox, path)).absolute, 'utf8')),
        ),
    }),
    defineTool({
      name: 'edit_file',
      description: 'Remplace un texte exact (une seule occurrence) dans un fichier du projet.',
      risk: 'safe',
      schema: z.object({
        path: z.string().min(1).max(200),
        search: z.string().min(1).max(4_000),
        replace: z.string().max(4_000),
      }),
      execute: ({ path, search, replace }) =>
        jailed(async () => {
          const file = await resolveInRepo(sandbox, path);
          const text = await readFile(file.absolute, 'utf8');
          const count = text.split(search).length - 1;
          if (count === 0)
            return fail(
              'recoverable',
              `Texte introuvable dans ${file.relative} : copie-le exactement depuis read_file.`,
            );
          if (count > 1)
            return fail(
              'recoverable',
              `Texte présent ${count} fois dans ${file.relative} : donne un extrait plus long.`,
            );
          const next = text.replace(search, () => replace);
          await writeFile(file.absolute, next);
          const reread = await readFile(file.absolute, 'utf8');
          return reread === next
            ? toolSuccess(`Modifié : ${file.relative}.`)
            : fail('recoverable', 'Relecture différente après écriture.');
        }),
    }),
  ]);
}
