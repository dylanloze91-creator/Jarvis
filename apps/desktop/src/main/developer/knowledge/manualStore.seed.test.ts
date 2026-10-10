import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEVELOPER_MANUAL_SEED,
  DEVELOPER_MANUAL_SEED_VERSION,
  developerManualSeedContent,
} from '@jarvis/core';
import { DeveloperManualStore } from './manualStore.js';

describe('DeveloperManualStore sur disque', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jarvis-manual-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const paths = () => ({
    shipped: join(root, 'developer', 'knowledge', 'shipped'),
    user: join(root, 'developer', 'knowledge', 'user'),
    learned: join(root, 'developer', 'knowledge', 'learned'),
  });

  it('une mise à jour du manuel livré n’écrase pas une fiche modifiée dans user/', async () => {
    const store = new DeveloperManualStore({ userDataPath: () => root });
    await store.ensureSeed();
    const { shipped, user } = paths();
    const name = 'typescript-strict.md';
    const custom = '# Ma version perso\n\nNe pas écraser.';
    mkdirSync(user, { recursive: true });
    writeFileSync(join(user, name), custom, 'utf8');
    writeFileSync(join(shipped, '.seed-version'), String(DEVELOPER_MANUAL_SEED_VERSION - 1), 'utf8');
    await store.ensureSeed();
    expect(readFileSync(join(user, name), 'utf8')).toBe(custom);
    expect(readFileSync(join(shipped, name), 'utf8')).toBe(developerManualSeedContent(name));
  });

  it('une mise à jour seed réécrit shipped/ mais laisse learned/ intact', async () => {
    const store = new DeveloperManualStore({ userDataPath: () => root });
    await store.ensureSeed();
    const { shipped, learned } = paths();
    mkdirSync(learned, { recursive: true });
    const fix = {
      id: 'fix-test-1',
      createdAt: 1,
      errorSignature: 'sig',
      symptom: 'sym',
      rootCause: 'cause',
      fixSummary: 'résumé',
      filesTouched: ['a.ts'],
      missionKind: 'modify' as const,
      model: 'm',
      proof: { suites: ['typecheck'] },
    };
    writeFileSync(join(learned, `${fix.id}.json`), JSON.stringify(fix), 'utf8');
    writeFileSync(join(shipped, '.seed-version'), String(DEVELOPER_MANUAL_SEED_VERSION - 1), 'utf8');
    writeFileSync(join(shipped, 'methode-travail.md'), '# Ancienne version livrée', 'utf8');
    await store.ensureSeed();
    expect(readFileSync(join(learned, `${fix.id}.json`), 'utf8')).toContain('fix-test-1');
    expect(readFileSync(join(shipped, 'methode-travail.md'), 'utf8')).toBe(
      developerManualSeedContent('methode-travail.md'),
    );
  });

  it('migre une modification legacy manual/ vers user/ sans l’écraser à la mise à jour', async () => {
    const legacy = join(root, 'developer', 'knowledge', 'manual');
    mkdirSync(legacy, { recursive: true });
    const name = 'methode-travail.md';
    const custom = '# Notes perso legacy\n\nGarder.';
    writeFileSync(join(legacy, name), custom, 'utf8');
    writeFileSync(join(legacy, '.seed-version'), String(DEVELOPER_MANUAL_SEED_VERSION - 1), 'utf8');

    const store = new DeveloperManualStore({ userDataPath: () => root });
    await store.ensureSeed();

    const { user, shipped } = paths();
    expect(readFileSync(join(user, name), 'utf8')).toBe(custom);
    expect(readFileSync(join(shipped, name), 'utf8')).toBe(developerManualSeedContent(name));
    expect(DEVELOPER_MANUAL_SEED[name]).toBeDefined();
  });
});
