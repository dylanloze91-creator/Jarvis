import { realpath } from 'node:fs/promises';
import { isAbsolute, relative as relativePath, resolve, sep } from 'node:path';
import { normalizeRepoRelative, protectedRepoPath } from '@jarvis/core';

export class RepoJailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoJailError';
  }
}

export interface JailedPath {
  absolute: string;
  relative: string;
}

async function real(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Chemin demandé par un outil de code → fichier réel dans la copie de travail.
 * Refuse l'absolu, `..`, les fichiers protégés, et tout lien symbolique qui
 * sort de la copie ou mène à un fichier protégé.
 */
export async function resolveInRepo(root: string, requested: string): Promise<JailedPath> {
  const rel = normalizeRepoRelative(requested);
  if (rel === null)
    throw new RepoJailError(
      `Chemin refusé : « ${requested} ». Donne un chemin relatif à la copie de travail, sans « .. ».`,
    );
  const blocked = protectedRepoPath(rel);
  if (blocked) throw new RepoJailError(`Chemin refusé : ${blocked}.`);
  const realRoot = await real(root);
  const absolute = await real(resolve(realRoot, rel));
  const inside =
    absolute === realRoot ||
    absolute.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
  if (!inside)
    throw new RepoJailError(
      `Chemin refusé : « ${requested} » sort de la copie de travail (lien symbolique ?).`,
    );
  const finalRelative = relativePath(realRoot, absolute).split(sep).join('/');
  if (isAbsolute(finalRelative)) throw new RepoJailError(`Chemin refusé : « ${requested} ».`);
  const finalBlocked = protectedRepoPath(finalRelative);
  if (finalBlocked) throw new RepoJailError(`Chemin refusé : ${finalBlocked}.`);
  return { absolute, relative: finalRelative };
}
