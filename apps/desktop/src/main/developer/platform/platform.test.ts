import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INSTALL_COMMANDS } from '@jarvis/core';
import { devPlatform } from './index.js';

const developerDir = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/testkit/.test(name)
      ? [path]
      : [];
  });
}

/** Programmes, chemins et appels propres à Windows : permis seulement dans platform/. */
const WINDOWS_ONLY: Array<[RegExp, string]> = [
  [/\btaskkill\b/i, 'taskkill'],
  [/\bwinget\b/i, 'winget'],
  [/['"`]nvidia-smi['"`]/, 'nvidia-smi lancé directement'],
  [/\bpowershell(\.exe)?\b/i, 'PowerShell'],
  [/APPDATA/, '%APPDATA%'],
  [/['"]win32['"]/, "comparaison avec 'win32'"],
  [/\bwin32\./, 'path.win32'],
  [/['"`][A-Za-z]:\\\\/, 'chemin Windows écrit en dur'],
];

describe('couche plateforme du mode Développeur (0.5.1)', () => {
  it('Windows : taskkill, winget, chemins sans casse, installateur NSIS', () => {
    const windows = devPlatform('win32');
    expect(windows.id).toBe('windows');
    expect(windows.installHint('git')).toBe(INSTALL_COMMANDS.git);
    expect(windows.installHint('node')).toBe(INSTALL_COMMANDS.node);
    expect(windows.pathKey('C:\\Dev\\Jarvis')).toBe(windows.pathKey('c:\\dev\\jarvis\\'));
    expect(windows.examplePath('Jarvis')).toBe('C:\\dev\\Jarvis');
    expect(windows.defaultProjectsRoot('C:\\Users\\x')).toBe('C:\\dev\\Projets');
    expect(windows.installer?.script).toBe('package:win');
    expect(windows.installer?.artifact('0.5.1')).toBe('Jarvis-Setup-0.5.1.exe');
    expect(windows.npmCliCandidates('C:\\Program Files\\nodejs\\node.exe')).toEqual([
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    ]);
    expect(windows.pathListSeparator).toBe(';');
    expect(windows.checksGitLongPaths).toBe(true);
  });

  it('autres systèmes : la branche non-Windows d’avant, sans installateur ni winget', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const other = devPlatform(platform);
      expect(other.id).toBe('posix');
      expect(other.installHint('git')).toBeNull();
      expect(other.installer).toBeNull();
      expect(other.pathListSeparator).toBe(':');
      expect(other.checksGitLongPaths).toBe(false);
      expect(other.defaultProjectsRoot('/home/x')).toBe(join('/home/x', 'dev', 'Projets'));
    }
  });

  it('aucun outil propre à Windows appelé hors de platform/', () => {
    const offenders: string[] = [];
    for (const file of sources(developerDir)) {
      const rel = relative(developerDir, file).split(sep).join('/');
      if (rel.startsWith('platform/')) continue;
      const text = readFileSync(file, 'utf8');
      for (const [pattern, label] of WINDOWS_ONLY) {
        if (pattern.test(text)) offenders.push(`${rel} : ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
