import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { INSTALL_COMMANDS } from '@jarvis/core';
import { NVIDIA_SMI_ARGS, NVIDIA_SMI_PROGRAM } from './gpu.js';
import type { DevPlatform } from './types.js';

/** Windows : seule implémentation propre à un système livrée aujourd'hui. */
export const windowsPlatform: DevPlatform = {
  id: 'windows',
  killTree(child) {
    if (!child.pid || child.exitCode !== null) return;
    // npm.cmd → node → vitest survivraient à un simple kill.
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    }).on('error', () => child.kill());
  },
  spawnDetached: false,
  gpuQuery: { program: NVIDIA_SMI_PROGRAM, args: NVIDIA_SMI_ARGS },
  installHint(tool) {
    if (tool === 'git') return INSTALL_COMMANDS.git;
    if (tool === 'node') return INSTALL_COMMANDS.node;
    return 'winget install --id Microsoft.DotNet.SDK.10 -e';
  },
  pathKey: (path) => win32.resolve(path).toLowerCase(),
  examplePath: (name) => `C:\\dev\\${name}`,
  defaultProjectsRoot: () => 'C:\\dev\\Projets',
  installer: {
    script: 'package:win',
    artifact: (version) => `Jarvis-Setup-${version}.exe`,
  },
  npmCliCandidates: (nodePath) => [
    win32.join(win32.dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ],
  pathListSeparator: ';',
  npmOnPathIsLink: false,
  checksGitLongPaths: true,
  dotnetProgram: 'dotnet',
};
