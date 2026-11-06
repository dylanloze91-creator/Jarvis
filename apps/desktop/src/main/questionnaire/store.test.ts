import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyPersonalization, parseSettings } from '@jarvis/core';
import { QuestionnaireStore } from './store.js';

describe('QuestionnaireStore.restore', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('supprime persona après restauration si elle était absente avant le questionnaire', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jarvis-q-'));
    const file = join(dir, 'questionnaire.json');
    const store = new QuestionnaireStore(() => file);

    let settings = parseSettings({});
    let personalization = emptyPersonalization();
    personalization.user.prenom = 'Théo';

    await store.set({ answers: { character: 'complice' } });
    await store.apply({
      readSettings: async () => settings,
      writeSettingsPatch: async (patch) => {
        settings = parseSettings({ ...settings, ...patch }, settings);
        return settings;
      },
      mergePersonalization: async (patch) => {
        personalization = {
          ...personalization,
          user: { ...personalization.user, ...patch.user },
          rules: patch.rules ?? personalization.rules,
        };
      },
      replacePersonalization: async (profile) => {
        personalization = profile;
      },
      environment: {
        ollamaModels: [],
        developerRepoValid: false,
        personalization,
      },
    });

    expect(settings.persona?.enabled).toBe(true);

    const restored = await store.restore({
      readSettings: async () => settings,
      writeSettings: async (next) => {
        settings = next;
        return settings;
      },
      replacePersonalization: async (profile) => {
        personalization = profile;
      },
    });

    expect(restored.settings?.persona).toBeUndefined();
    expect(personalization.user.prenom).toBe('Théo');
    const raw = JSON.parse(await readFile(file, 'utf8'));
    expect(raw.settingsBackup).toBeNull();
  });
});
