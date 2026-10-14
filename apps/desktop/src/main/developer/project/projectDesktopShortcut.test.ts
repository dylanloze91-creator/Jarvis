import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunSpec } from '../runner.js';
import { fakeOutcome } from '../controllerHarness.testkit.js';
import { createProjectDesktopShortcut } from '../platform/projectDesktopShortcut.js';
import { projectIdFromPlayArgs } from './projectPlayArg.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('raccourci projet Windows', () => {
  it('bâtit avec node + npm-cli puis conserve l’argument projet', async () => {
    const home = mkdtempSync(join(tmpdir(), 'jarvis-shortcut-'));
    dirs.push(home);
    mkdirSync(join(home, 'Desktop'), { recursive: true });
    const projectRoot = join(home, 'Projet Jeu');
    mkdirSync(join(projectRoot, 'dist'), { recursive: true });
    writeFileSync(join(projectRoot, 'dist', 'index.html'), '<canvas></canvas>');
    const calls: RunSpec[] = [];
    const result = await createProjectDesktopShortcut({
      projectId: 'plateforme-dexios',
      projectName: 'Plateforme Dexios',
      template: 'web-game',
      projectRoot,
      platform: 'win32',
      home,
      jarvisExe: 'C:\\Program Files\\Jarvis\\Jarvis.exe',
      node: { nodePath: 'C:\\Node\\node.exe', npmCli: 'C:\\Node\\npm-cli.js' },
      run: async (spec) => {
        calls.push(spec);
        return fakeOutcome(spec.display ?? 'npm run build');
      },
    });
    expect(calls[0]).toMatchObject({
      program: 'C:\\Node\\node.exe',
      args: ['C:\\Node\\npm-cli.js', 'run', 'build'],
    });
    expect(result).not.toBeNull();
    expect(readFileSync(result!.path, 'utf8')).toContain(
      '--jarvis-play-project=plateforme-dexios',
    );
  });

  it('lit l’argument aussi dans argv de la seconde instance', () => {
    expect(
      projectIdFromPlayArgs([
        'Jarvis.exe',
        '--jarvis-play-project=plateforme-dexios',
      ]),
    ).toBe('plateforme-dexios');
    expect(projectIdFromPlayArgs(['Jarvis.exe', '--jarvis-play-project=../secret'])).toBeNull();
  });
});

