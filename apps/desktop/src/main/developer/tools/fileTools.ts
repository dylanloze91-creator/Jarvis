import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { defineTool, toolSuccess, type RegisteredTool } from '@jarvis/core';
import type { Sandbox } from '../task/sandbox.js';
import { resolveForWrite } from '../task/writeJail.js';
import { fail, guarded } from './common.js';

export interface FileToolDeps {
  sandbox: () => Sandbox | null;
}

const MAX_FILE_CHARS = 200_000;

function lineCount(text: string): number {
  return text ? text.split('\n').length : 0;
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Remplacement exact et unique ; respecte les fins de ligne CRLF du fichier. */
export function applyExactEdit(
  content: string,
  search: string,
  replace: string,
): { ok: true; text: string } | { ok: false; reason: string } {
  if (!search) return { ok: false, reason: 'extrait vide' };
  let s = search;
  let r = replace;
  if (!content.includes(s) && content.includes('\r\n') && !s.includes('\r\n')) {
    s = s.replace(/\n/g, '\r\n');
    r = r.replace(/\r?\n/g, '\r\n');
  }
  const count = occurrences(content, s);
  if (count === 0) return { ok: false, reason: 'introuvable' };
  if (count > 1) return { ok: false, reason: `présent ${count} fois` };
  const index = content.indexOf(s);
  return { ok: true, text: content.slice(0, index) + r + content.slice(index + s.length) };
}

export function createFileTools(deps: FileToolDeps): RegisteredTool[] {
  const root = () => deps.sandbox()?.path ?? null;
  return [
    defineTool({
      name: 'dev_create_file',
      description:
        'Crée un NOUVEAU fichier dans la copie isolée (chemin relatif). Pour un fichier existant, utilise dev_edit_file.',
      risk: 'confirm',
      schema: z.object({
        path: z.string().min(1).max(400),
        content: z.string().max(MAX_FILE_CHARS),
      }),
      summarize: ({ path, content }) => `Créer ${path} (${lineCount(content)} lignes).`,
      describeCommand: ({ path, content }) => `Créer ${path} (+${lineCount(content)} lignes)`,
      execute: ({ path, content }) =>
        guarded(root, async (base) => {
          const file = await resolveForWrite(base, path);
          if (existsSync(file.absolute))
            return fail('definitive', `${file.relative} existe déjà : utilise dev_edit_file.`);
          await mkdir(dirname(file.absolute), { recursive: true });
          await writeFile(file.absolute, content, 'utf8');
          const back = await readFile(file.absolute, 'utf8');
          if (back !== content)
            return fail('recoverable', `Relecture de ${file.relative} différente.`);
          await deps.sandbox()?.git(['add', '--', file.relative], 'git add');
          return toolSuccess(
            `Fichier ${file.relative} créé (${lineCount(content)} lignes), relu.`,
            {
              path: file.relative,
            },
          );
        }),
    }),
    defineTool({
      name: 'dev_edit_file',
      description:
        'Modifie un fichier de la copie isolée : remplace un extrait EXACT et UNIQUE (search) par replace. Lis le fichier avant.',
      risk: 'confirm',
      schema: z.object({
        path: z.string().min(1).max(400),
        search: z.string().min(1).max(MAX_FILE_CHARS),
        replace: z.string().max(MAX_FILE_CHARS),
      }),
      summarize: ({ path }) => `Modifier ${path} (remplacement exact).`,
      describeCommand: ({ path, search, replace }) =>
        `Modifier ${path} (−${lineCount(search)} +${lineCount(replace)} lignes)`,
      execute: ({ path, search, replace }) =>
        guarded(root, async (base) => {
          const file = await resolveForWrite(base, path);
          if (!existsSync(file.absolute))
            return fail('definitive', `${file.relative} n’existe pas : utilise dev_create_file.`);
          const before = await readFile(file.absolute, 'utf8');
          const edit = applyExactEdit(before, search, replace);
          if (!edit.ok)
            return fail(
              'recoverable',
              edit.reason === 'introuvable'
                ? `Extrait introuvable dans ${file.relative}. Relis le fichier (dev_read_file) et copie l’extrait exact, indentation comprise.`
                : `L’extrait est ${edit.reason} dans ${file.relative} : ajoute des lignes autour pour qu’il soit unique.`,
            );
          await writeFile(file.absolute, edit.text, 'utf8');
          const back = await readFile(file.absolute, 'utf8');
          if (back !== edit.text)
            return fail('recoverable', `Relecture de ${file.relative} différente.`);
          return toolSuccess(`${file.relative} modifié et relu.`, { path: file.relative });
        }),
    }),
    defineTool({
      name: 'dev_delete_file',
      description:
        'Supprime UN fichier de la copie isolée. Demande toujours l’accord de l’utilisateur.',
      risk: 'confirm',
      forceConfirm: true,
      schema: z.object({ path: z.string().min(1).max(400) }),
      summarize: ({ path }) => `Supprimer ${path}.`,
      describeCommand: ({ path }) => `Supprimer ${path}`,
      execute: ({ path }) =>
        guarded(root, async (base) => {
          const file = await resolveForWrite(base, path);
          if (!existsSync(file.absolute))
            return fail('definitive', `${file.relative} n’existe pas.`);
          if ((await stat(file.absolute)).isDirectory())
            return fail('definitive', `${file.relative} est un dossier : un fichier à la fois.`);
          await unlink(file.absolute);
          return toolSuccess(`${file.relative} supprimé (récupérable par un retour arrière).`, {
            path: file.relative,
          });
        }),
    }),
  ];
}
