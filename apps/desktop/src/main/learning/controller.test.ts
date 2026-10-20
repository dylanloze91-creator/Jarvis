import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseSettings, type Settings } from '@jarvis/core';
import { LocalLearningController } from './controller.js';
import { LocalLearningStore } from './store.js';

function harness(dir: string, settings: Settings, extra?: ConstructorParameters<typeof LocalLearningController>[4]) {
  let current = settings;
  const store = new LocalLearningStore(() => dir);
  const controller = new LocalLearningController(
    store,
    () => current,
    async (patch) => {
      current = parseSettings({ ...current, ...patch }, current);
      return current;
    },
    () => dir,
    extra,
  );
  return { controller, store, settings: () => current };
}

describe('LocalLearningController', () => {
  it('saute l’entraînement quand il n’y a pas assez d’exemples', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-train-skip-'));
    const { controller } = harness(dir, parseSettings({}));
    await controller.trainNow();
    expect(controller.status().line).toMatch(/Pas assez d’exemples/);
    expect(controller.status().running).toBe(false);
  });

  it('refuse l’entraînement si la mémoire vive ne suffit pas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-train-ram-'));
    const { controller, store } = harness(dir, parseSettings({}), {
      measureResources: async () => ({ ramBytes: 1024, vramBytes: null }),
    });
    for (let i = 0; i < 8; i += 1) {
      await store.append({
        id: `e${i}`,
        at: i,
        user: `question numero${i} sur le respawn du joueur`,
        assistant: `reponse numero${i} avec la touche demandee`,
        toolsOk: [],
        conversationId: 'c',
      });
    }
    await controller.trainNow();
    expect(controller.status().line).toMatch(/Mémoire vive insuffisante/);
    expect(controller.status().running).toBe(false);
  });

  it('restaure le dossier et le nom de l’adaptateur précédent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-train-rollback-'));
    const { controller, store, settings } = harness(
      dir,
      parseSettings({
        localLearning: { enabled: true, activeOllamaModel: 'nouveau', previousOllamaModel: 'ancien' },
      }),
    );
    await mkdir(store.currentAdapterDir(), { recursive: true });
    await writeFile(join(store.currentAdapterDir(), 'mark.txt'), 'nouveau', 'utf8');
    await mkdir(store.previousAdapterDir(), { recursive: true });
    await writeFile(join(store.previousAdapterDir(), 'mark.txt'), 'ancien', 'utf8');
    await controller.rollback();
    expect(await readFile(join(store.currentAdapterDir(), 'mark.txt'), 'utf8')).toBe('ancien');
    expect(await readFile(join(store.previousAdapterDir(), 'mark.txt'), 'utf8')).toBe('nouveau');
    expect(settings().localLearning.activeOllamaModel).toBe('ancien');
    expect(settings().localLearning.previousOllamaModel).toBe('nouveau');
    expect(settings().model).toBe(parseSettings({}).model);
  });

  it('ne lance pas la recherche périodique tant qu’elle est coupée', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-watch-off-'));
    const search = vi.fn(async () => []);
    const { controller } = harness(dir, parseSettings({}), { search });
    await controller.runWatchSearch();
    expect(search).not.toHaveBeenCalled();
  });

  it('note une erreur réseau et n’enregistre rien', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-watch-net-'));
    const applyLearning = vi.fn(async (record: import('@jarvis/core').LearningRecord) => [record]);
    const { controller } = harness(
      dir,
      parseSettings({
        developer: { periodicWebResearch: true, watchTopics: ['typescript docs'] },
      }),
      {
        search: async () => {
          throw new Error('ECONNREFUSED');
        },
        applyLearning,
      },
    );
    await controller.runWatchSearch();
    expect(applyLearning).not.toHaveBeenCalled();
    expect(controller.status().line).toMatch(/repli sans clé/);
  });
});
