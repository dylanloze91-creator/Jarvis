import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { projectIdFor, type ProjectEntry } from '@jarvis/core';

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

export interface PickedProjectDirectory {
  id: string;
  dir: string;
  /** Dossier initialement prévu mais non vide ou déjà enregistré. */
  redirectedFrom?: string;
}

async function dirIsEmpty(path: string): Promise<boolean> {
  if (!existsSync(path)) return true;
  try {
    return (await readdir(path)).length === 0;
  } catch {
    return false;
  }
}

/**
 * Choisit un identifiant et un dossier vides sous `root`, sans écraser un projet existant.
 */
export async function pickProjectDirectory(
  root: string,
  projectName: string,
  entries: readonly ProjectEntry[],
): Promise<PickedProjectDirectory> {
  const taken = new Set(entries.map((e) => e.id));
  let redirectedFrom: string | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const name = attempt === 0 ? projectName : `${projectName} ${attempt + 1}`;
    const id = projectIdFor(name, taken);
    taken.add(id);
    const dir = join(root, id);
    if (entries.some((e) => samePath(e.path, dir))) continue;
    const empty = await dirIsEmpty(dir);
    if (empty) {
      return redirectedFrom ? { id, dir, redirectedFrom } : { id, dir };
    }
    if (!redirectedFrom) redirectedFrom = id;
  }
  throw new Error('Impossible de trouver un dossier vide pour ce projet.');
}
