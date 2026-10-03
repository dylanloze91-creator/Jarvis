import { dirname, join, resolve } from 'node:path';
import { NVIDIA_SMI_ARGS, NVIDIA_SMI_PROGRAM } from './gpu.js';
import type { DevPlatform } from './types.js';

/**
 * Comportement non-Windows déjà présent (Linux de la machine de test).
 * Ce n'est pas une implémentation macOS : rien n'y est propre à macOS.
 */
export const posixPlatform: DevPlatform = {
  id: 'posix',
  killTree(child) {
    if (!child.pid || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  },
  spawnDetached: true,
  gpuQuery: { program: NVIDIA_SMI_PROGRAM, args: NVIDIA_SMI_ARGS },
  installHint: () => null,
  pathKey: (path) => resolve(path),
  examplePath: (name) => `~/dev/${name}`,
  defaultProjectsRoot: (home) => join(home, 'dev', 'Projets'),
  installer: null,
  npmCliCandidates: (nodePath) => {
    const dir = dirname(nodePath);
    return [
      join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
  },
  pathListSeparator: ':',
  npmOnPathIsLink: true,
  checksGitLongPaths: false,
  dotnetProgram: 'dotnet',
};
