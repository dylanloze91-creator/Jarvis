import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { platformerWebGameFiles } from '@jarvis/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TEMPLATE_STILL_LINE,
  creationJournalBanner,
  levelDelivered,
  presentWrittenGame,
} from './history.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeTemplate(root: string): void {
  const files = platformerWebGameFiles({
    packageName: 'jeu',
    title: 'Jeu',
    description: 'gabarit',
  });
  for (const file of files) {
    const path = join(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
  }
}

describe('livraison : gabarit ou vrai niveau', () => {
  it('un gabarit inchangé ne dit pas « Jeu écrit »', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-gabarit-'));
    roots.push(root);
    writeTemplate(root);
    expect(levelDelivered(root)).toBe(false);
    const opened: string[] = [];
    const presented = await presentWrittenGame({
      root,
      openPreview: async (folder) => {
        opened.push(folder);
        return true;
      },
      placeShortcut: async () => 'Bureau',
    });
    expect(presented.delivered).toBe(false);
    expect(presented.opened).toBe(false);
    expect(opened).toEqual([]);
    expect(presented.line).toBe(TEMPLATE_STILL_LINE);
    expect(presented.line).not.toMatch(/Jeu écrit/);
    const banner = creationJournalBanner({
      ok: false,
      folderWritten: true,
      levelWritten: false,
      summary:
        "EPERM: operation not permitted, rename 'C:\\Users\\dylan\\AppData\\Roaming\\@jarvis\\missions\\a.json.21.tmp'",
    });
    expect(banner.retry).toBe(true);
    expect(banner.kept).toBe(false);
    expect(banner.text).toBe(TEMPLATE_STILL_LINE);
    expect(banner.text).not.toMatch(/Jeu écrit|AppData/);
  });

  it('un niveau écrit ouvre l’aperçu sur le dossier du jeu', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-niveau-'));
    roots.push(root);
    writeTemplate(root);
    writeFileSync(
      join(root, 'src', 'level.ts'),
      `export const PLAY_LEVEL = {
  platforms: [{ x: 0, y: 400, w: 960, h: 32 }],
  collectible: { x: 80, y: 80, w: 16, h: 16 },
  hazard: { x: 200, y: 200, w: 40, h: 16 },
  goal: { x: 700, y: 120, w: 28, h: 64 },
  spawn: { x: 24, y: 200 },
};
`,
    );
    expect(levelDelivered(root)).toBe(true);
    const opened: string[] = [];
    const shortcuts: string[] = [];
    const presented = await presentWrittenGame({
      root,
      openPreview: async (folder) => {
        opened.push(folder);
        return true;
      },
      placeShortcut: async (folder) => {
        shortcuts.push(folder);
        return 'Bureau';
      },
    });
    expect(presented.delivered).toBe(true);
    expect(opened).toEqual([root]);
    expect(shortcuts).toEqual([root]);
    expect(presented.line).toMatch(/Jeu écrit/);
    expect(presented.line).toMatch(/Aperçu ouvert/);
  });
});
