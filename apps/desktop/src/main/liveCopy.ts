import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { copyLiveIntoTest, type CopyHost, type CopyReport } from '@jarvis/core';

/** Dossier de l'installateur Live : `%APPDATA%\\Jarvis`. On ne le crée pas. */
export function installedLiveDir(): string {
  return join(app.getPath('appData'), 'Jarvis');
}

function host(): CopyHost {
  return {
    readFile: (path) => readFile(path),
    writeFile: async (path, data) => {
      await writeFile(path, data, { mode: 0o600 });
    },
    mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    readdir: async (path) => {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
    },
  };
}

async function note(userData: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  const dir = join(userData, 'logs');
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, 'copie-live.log'), `${lines.join('\n')}\n`, 'utf8');
}

/** Lit Jarvis Live, écrit seulement dans le dossier de cette application. */
export async function copyInstalledLive(userData: string): Promise<CopyReport> {
  const lines: string[] = [];
  const report = await copyLiveIntoTest({
    liveRoot: installedLiveDir(),
    testRoot: userData,
    host: host(),
    cipher: {
      tryDecrypt: (bytes) => {
        try {
          if (!safeStorage.isEncryptionAvailable()) return null;
          return safeStorage.decryptString(Buffer.from(bytes));
        } catch {
          return null;
        }
      },
    },
    log: (line) => lines.push(line),
  });
  await note(userData, lines);
  return report;
}

export async function liveDirExists(): Promise<boolean> {
  try {
    return (await stat(installedLiveDir())).isDirectory();
  } catch {
    return false;
  }
}
