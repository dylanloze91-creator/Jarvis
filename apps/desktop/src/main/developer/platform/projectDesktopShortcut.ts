import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  defaultDesktopShortcutLabel,
  dotnetWinExeArtifactRelative,
  isDotnetWindowsDesktopTemplate,
  type ProjectTemplateId,
} from '@jarvis/core';
import type { Runner } from '../runner.js';
import { runProcess } from '../runner.js';

export interface DesktopShortcutResult {
  label: string;
  path: string;
}

function desktopDir(home: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    const oneDrive = process.env.OneDrive;
    if (oneDrive && existsSync(join(oneDrive, 'Desktop'))) return join(oneDrive, 'Desktop');
    return join(home, 'Desktop');
  }
  return join(home, 'Desktop');
}

async function writeWindowsBatShortcut(
  desktop: string,
  fileName: string,
  body: string,
): Promise<string> {
  const path = join(desktop, fileName);
  await mkdir(desktop, { recursive: true });
  await writeFile(path, body, 'utf8');
  return path;
}

/**
 * Raccourci bureau pour tester le livrable (5.0.27) : .bat qui ouvre le jeu buildé
 * ou lance l’exe publié pour une appli Windows.
 */
export async function createProjectDesktopShortcut(options: {
  projectName: string;
  template: ProjectTemplateId | undefined;
  projectRoot: string;
  platform: NodeJS.Platform;
  home: string;
  run?: Runner;
}): Promise<DesktopShortcutResult | null> {
  const label = defaultDesktopShortcutLabel(options.projectName);
  const desktop = desktopDir(options.home, options.platform);
  const root = resolve(options.projectRoot);

  if (options.template === 'web-game') {
    const runner = options.run ?? runProcess;
    const build = await runner({
      program: 'npm',
      args: ['run', 'build'],
      cwd: root,
      display: 'npm run build',
      timeoutMs: 10 * 60_000,
      maxBytes: 200_000,
    });
    if (build.code !== 0) return null;
    const index = join(root, 'dist', 'index.html');
    if (!existsSync(index)) return null;
    const fileName = `${label.replace(/[^\p{L}\p{N}\-— ]/gu, '').trim()}.bat`;
    const bat =
      options.platform === 'win32'
        ? `@echo off\r\nstart "" "${index}"\r\n`
        : `#!/bin/sh\nxdg-open "${index}"\n`;
    const path = await writeWindowsBatShortcut(
      desktop,
      fileName.endsWith('.bat') ? fileName : `${fileName}.bat`,
      bat,
    );
    return { label: fileName.replace(/\.bat$/i, ''), path };
  }

  if (options.template && isDotnetWindowsDesktopTemplate(options.template)) {
    const rel = dotnetWinExeArtifactRelative(options.projectName);
    const exe = join(root, rel);
    if (!existsSync(exe)) return null;
    const fileName = `${label.replace(/[^\p{L}\p{N}\-— ]/gu, '').trim()}.bat`;
    const bat =
      options.platform === 'win32'
        ? `@echo off\r\ncd /d "${root}"\r\nstart "" "${exe}"\r\n`
        : `#!/bin/sh\n# .exe Windows : ouvrir sur un PC Windows\n`;
    const path = await writeWindowsBatShortcut(desktop, `${fileName}.bat`, bat);
    return { label: fileName, path };
  }

  return null;
}
