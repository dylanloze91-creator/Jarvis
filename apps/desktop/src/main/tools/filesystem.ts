import { cp, rename, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';
import { moveToTrash } from './platform/trash.js';

const pathPair = {
  source: z.string().min(1).describe('Chemin absolu du fichier ou dossier source.'),
  destination: z.string().min(1).describe('Chemin absolu de destination.'),
  overwrite: z.boolean().default(false).describe('Écraser la destination si elle existe déjà.'),
};

export const moveFileTool = defineTool({
  name: 'move_file',
  description: 'Déplace ou renomme un fichier ou un dossier vers un nouveau chemin.',
  risk: 'confirm',
  category: 'files',
  isDestructive: (input: { overwrite?: boolean }) => Boolean(input.overwrite),
  schema: z.object(pathPair),
  summarize: ({ source, destination, overwrite }) =>
    `Déplacer « ${source} » vers « ${destination} »${overwrite ? ' (écrase la destination si elle existe)' : ''}.`,
  execute: async ({ source, destination, overwrite }) => {
    const selfMove = await checkNotIntoItself(source, destination);
    if (selfMove) return selfMove;
    const guard = await checkDestination(destination, overwrite);
    if (guard) return guard;

    try {
      await rename(source, destination);
      return {
        ok: true,
        content: `Déplacé : ${source} → ${destination}`,
        data: { source, destination },
      };
    } catch (error) {
      // EXDEV : source et destination ne sont pas sur le même volume, rename() échoue.
      if (isCode(error, 'EXDEV')) {
        try {
          await cp(source, destination, {
            recursive: true,
            force: overwrite,
            errorOnExist: !overwrite,
          });
          await removeAfterCrossDeviceMove(source);
          return {
            ok: true,
            content: `Déplacé : ${source} → ${destination}`,
            data: { source, destination },
          };
        } catch (copyError) {
          return { ok: false, content: `Échec du déplacement : ${describeError(copyError)}` };
        }
      }
      return { ok: false, content: `Échec du déplacement : ${describeError(error)}` };
    }
  },
});

export const copyFileTool = defineTool({
  name: 'copy_file',
  description: 'Copie un fichier ou un dossier (récursivement) vers un nouveau chemin.',
  risk: 'confirm',
  category: 'files',
  isDestructive: (input: { overwrite?: boolean }) => Boolean(input.overwrite),
  schema: z.object(pathPair),
  summarize: ({ source, destination, overwrite }) =>
    `Copier « ${source} » vers « ${destination} »${overwrite ? ' (écrase la destination si elle existe)' : ''}.`,
  execute: async ({ source, destination, overwrite }) => {
    const selfCopy = await checkNotIntoItself(source, destination);
    if (selfCopy) return selfCopy;
    const guard = await checkDestination(destination, overwrite);
    if (guard) return guard;

    try {
      await cp(source, destination, {
        recursive: true,
        force: overwrite,
        errorOnExist: !overwrite,
      });
      return {
        ok: true,
        content: `Copié : ${source} → ${destination}`,
        data: { source, destination },
      };
    } catch (error) {
      return { ok: false, content: `Échec de la copie : ${describeError(error)}` };
    }
  },
});

export const deleteFileTool = defineTool({
  name: 'delete_file',
  description:
    'Envoie un fichier ou un dossier à la corbeille (jamais un effacement définitif). Action irréversible sans passage par la corbeille du système : demande toujours confirmation.',
  risk: 'confirm',
  category: 'files',
  forceConfirm: true,
  isDestructive: true,
  schema: z.object({
    path: z.string().min(1).describe('Chemin absolu du fichier ou dossier à supprimer.'),
  }),
  summarize: ({ path }) => `Envoyer « ${path} » à la corbeille.`,
  describeCommand: ({ path }) => `Corbeille : ${path}`,
  execute: async ({ path }) => {
    const result = await moveToTrash(path);
    return { ok: result.ok, content: result.message, data: { path } };
  },
});

async function checkDestination(
  destination: string,
  overwrite: boolean,
): Promise<{ ok: false; content: string } | null> {
  if (overwrite) return null;
  try {
    await stat(destination);
    return {
      ok: false,
      content: `« ${destination} » existe déjà. Relance avec overwrite=true pour l'écraser.`,
    };
  } catch {
    return null;
  }
}

async function removeAfterCrossDeviceMove(source: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(source, { recursive: true, force: true });
}

async function checkNotIntoItself(
  source: string,
  destination: string,
): Promise<{ ok: false; content: string } | null> {
  try {
    const info = await stat(source);
    if (!info.isDirectory()) return null;
  } catch {
    return null; // La source n'existe pas : l'opération elle-même le signalera.
  }

  const rel = relative(resolve(source), resolve(destination));
  const isInside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (isInside) {
    return {
      ok: false,
      content: `Impossible : « ${destination} » est à l'intérieur de « ${source} ».`,
    };
  }
  return null;
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
