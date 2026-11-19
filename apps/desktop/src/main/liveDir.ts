import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Dossiers où Jarvis Live garde ses données, dans l'ordre où on les cherche.
 *
 * Live ne fixe pas `userData` : Electron prend le nom du paquet, `@jarvis/desktop`, donc
 * `%APPDATA%\@jarvis\desktop` (relevé sur le PC de l'utilisateur le 16 novembre 2026 :
 * `%APPDATA%\Jarvis` n'existe pas). `Jarvis` reste en second, au cas où une installation
 * porterait le nom du produit.
 */
export function liveDirCandidates(appData: string): string[] {
  return [join(appData, '@jarvis', 'desktop'), join(appData, 'Jarvis')];
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Premier dossier de Live qui existe, ou `null`. On ne le crée jamais. */
export async function findLiveDir(
  appData: string,
  exists: (path: string) => Promise<boolean> = isDirectory,
): Promise<string | null> {
  for (const dir of liveDirCandidates(appData)) {
    if (await exists(dir)) return dir;
  }
  return null;
}
