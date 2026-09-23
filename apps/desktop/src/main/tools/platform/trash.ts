import { constants } from 'node:fs';
import { access, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { basename, join } from 'node:path';
import { psQuote, run, runPowerShell } from './exec.js';

export interface TrashResult {
  ok: boolean;
  message: string;
}

/**
 * Envoie un fichier ou un dossier à la corbeille plutôt que de l'effacer
 * définitivement, sur les trois systèmes, sans dépendance native à compiler :
 * - Windows : l'assembly `Microsoft.VisualBasic`, intégrée au .NET Framework,
 *   expose `FileSystem.DeleteFile`/`DeleteDirectory` avec l'option
 *   `SendToRecycleBin`. Aucune installation supplémentaire n'est nécessaire.
 * - macOS : AppleScript demande au Finder de supprimer le fichier, ce qui le
 *   place dans la corbeille.
 * - Linux : implémentation directe de la spécification XDG Trash (déplacement
 *   vers `~/.local/share/Trash/files` + fichier `.trashinfo`), reconnue par
 *   les gestionnaires de fichiers GNOME et KDE.
 */
export async function moveToTrash(targetPath: string): Promise<TrashResult> {
  try {
    await access(targetPath, constants.F_OK);
  } catch {
    return { ok: false, message: `Chemin introuvable : ${targetPath}` };
  }

  if (process.platform === 'win32') return trashOnWindows(targetPath);
  if (process.platform === 'darwin') return trashOnMac(targetPath);
  if (process.platform === 'linux') return trashOnLinux(targetPath);
  return {
    ok: false,
    message: `Corbeille non prise en charge sur cette plateforme (${process.platform}).`,
  };
}

async function trashOnWindows(targetPath: string): Promise<TrashResult> {
  const info = await stat(targetPath);
  const method = info.isDirectory() ? 'DeleteDirectory' : 'DeleteFile';
  const script = [
    'Add-Type -AssemblyName Microsoft.VisualBasic;',
    `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}(${psQuote(targetPath)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
  ].join(' ');

  const result = await runPowerShell(script, { timeoutMs: 15_000 });
  if (result.code === 0 && !result.timedOut) {
    return { ok: true, message: `Envoyé à la corbeille : ${targetPath}` };
  }
  return {
    ok: false,
    message: `Échec de l'envoi à la corbeille : ${result.stderr || result.stdout || 'erreur inconnue'}`,
  };
}

async function trashOnMac(targetPath: string): Promise<TrashResult> {
  const script = `tell application "Finder" to delete POSIX file "${targetPath.replace(/"/g, '\\"')}"`;
  const result = await run('osascript', ['-e', script], { timeoutMs: 15_000 });
  if (result.code === 0) {
    return { ok: true, message: `Envoyé à la corbeille : ${targetPath}` };
  }
  return {
    ok: false,
    message: `Échec de l'envoi à la corbeille : ${result.stderr || 'erreur inconnue'}`,
  };
}

async function trashOnLinux(targetPath: string): Promise<TrashResult> {
  const dataHome = process.env.XDG_DATA_HOME || join(os.homedir(), '.local', 'share');
  const trashDir = join(dataHome, 'Trash');
  const filesDir = join(trashDir, 'files');
  const infoDir = join(trashDir, 'info');
  await mkdir(filesDir, { recursive: true });
  await mkdir(infoDir, { recursive: true });

  const name = basename(targetPath);
  const { destination, trashName } = await uniqueDestination(filesDir, name);

  await rename(targetPath, destination);
  await writeFile(
    join(infoDir, `${trashName}.trashinfo`),
    [
      '[Trash Info]',
      `Path=${encodeTrashPath(targetPath)}`,
      `DeletionDate=${new Date().toISOString().replace(/\.\d+Z$/, '')}`,
      '',
    ].join('\n'),
    'utf8',
  );

  return { ok: true, message: `Envoyé à la corbeille (${trashDir}) : ${targetPath}` };
}

async function uniqueDestination(
  filesDir: string,
  name: string,
): Promise<{ destination: string; trashName: string }> {
  let candidate = name;
  let attempt = 0;
  while (await exists(join(filesDir, candidate))) {
    attempt += 1;
    candidate = `${name}.${attempt}`;
  }
  return { destination: join(filesDir, candidate), trashName: candidate };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** La spécification XDG exige une URI-encodage des chemins, `/` conservés. */
function encodeTrashPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
