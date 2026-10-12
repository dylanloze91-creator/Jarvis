import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { folderRedirectChatLine } from '@jarvis/core';
import { pickProjectDirectory } from './projectDirectory.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-pick-dir-'));

afterEach(() => {
  for (const name of ['occupied', 'photos-par-date', 'photos-par-date-2']) {
    const p = join(base, name);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
});

describe('pickProjectDirectory', () => {
  it('choisit un autre dossier si le premier est occupé', async () => {
    const occupied = join(base, 'photos-par-date');
    mkdirSync(occupied, { recursive: true });
    writeFileSync(join(occupied, 'old.txt'), 'x');
    const picked = await pickProjectDirectory(base, 'Photos par date', []);
    expect(picked.id).not.toBe('photos-par-date');
    expect(picked.redirectedFrom).toBe('photos-par-date');
    expect(folderRedirectChatLine(picked.redirectedFrom!, picked.id)).toMatch(/pas vide|pas sûr/i);
  });

  it('réutilise un dossier vide existant', async () => {
    const empty = join(base, 'photos-par-date');
    mkdirSync(empty, { recursive: true });
    const picked = await pickProjectDirectory(base, 'Photos par date', []);
    expect(picked.id).toBe('photos-par-date');
    expect(picked.dir).toBe(empty);
  });
});
