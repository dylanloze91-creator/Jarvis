import { existsSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, relative as relativePath, resolve, sep } from 'node:path';
import { normalizeRepoRelative, protectedRepoPath } from '@jarvis/core';
import { RepoJailError, type JailedPath } from '../tools/jail.js';

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
// eslint-disable-next-line no-control-regex -- caractères interdits dans un nom de fichier Windows.
const INVALID_CHARS = /[<>:"|?*\u0000-\u001F]/;

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Chemin d'écriture dans la copie isolée. En plus des règles de lecture :
 * noms Windows invalides ou réservés, flux NTFS (`a.ts:x`), points ou espaces
 * finaux, et dossier parent qui sortirait de la copie par un lien.
 */
export async function resolveForWrite(root: string, requested: string): Promise<JailedPath> {
  const rel = normalizeRepoRelative(requested);
  if (rel === null || rel === '')
    throw new RepoJailError(
      `Chemin refusé : « ${requested} ». Donne un chemin relatif à la copie isolée, sans « .. ».`,
    );
  for (const segment of rel.split('/')) {
    if (INVALID_CHARS.test(segment) || /[. ]$/.test(segment) || RESERVED.test(segment))
      throw new RepoJailError(`Nom de fichier refusé : « ${segment} ».`);
  }
  const blocked = protectedRepoPath(rel);
  if (blocked) throw new RepoJailError(`Chemin refusé : ${blocked}.`);
  const realRoot = await realpath(root);
  const absolute = resolve(realRoot, rel);
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const realAncestor = await realpath(ancestor);
  if (!inside(realRoot, realAncestor))
    throw new RepoJailError(`Chemin refusé : « ${requested} » sort de la copie isolée.`);
  if (existsSync(absolute)) {
    const info = await lstat(absolute);
    if (info.isSymbolicLink())
      throw new RepoJailError(`Chemin refusé : « ${requested} » est un lien symbolique.`);
  }
  const finalRelative = relativePath(
    realRoot,
    resolve(realAncestor, relativePath(ancestor, absolute)),
  )
    .split(sep)
    .join('/');
  const finalBlocked = protectedRepoPath(finalRelative);
  if (finalBlocked) throw new RepoJailError(`Chemin refusé : ${finalBlocked}.`);
  return {
    absolute: resolve(realAncestor, relativePath(ancestor, absolute)),
    relative: finalRelative,
  };
}
