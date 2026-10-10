import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEVELOPER_MANUAL_SEED_VERSION } from '@jarvis/core';
import { DeveloperManualStore } from './manualStore.js';

describe('DeveloperManualStore seed', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jarvis-manual-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('n’écrase pas une fiche manuelle modifiée par l’utilisateur', async () => {
    const store = new DeveloperManualStore({ userDataPath: () => root });
    await store.ensureSeed();
    const manualDir = join(root, 'developer', 'knowledge', 'manual');
    const name = 'typescript-strict.md';
    const custom = '# Ma version perso\n\nNe pas écraser.';
    writeFileSync(join(manualDir, name), custom, 'utf8');
    writeFileSync(join(manualDir, '.seed-version'), String(DEVELOPER_MANUAL_SEED_VERSION - 1), 'utf8');
    await store.ensureSeed();
    expect(readFileSync(join(manualDir, name), 'utf8')).toBe(custom);
  });
});
