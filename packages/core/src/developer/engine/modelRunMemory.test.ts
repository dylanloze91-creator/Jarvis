import { describe, expect, it } from 'vitest';
import {
  appendModelRun,
  modelRunCategory,
  pickModelFromRunMemory,
} from './modelRunMemory.js';

describe('pickModelFromRunMemory', () => {
  const installed = new Set(['alpha:3b', 'beta:4b']);
  const category = modelRunCategory('CODER', 'new-project');

  it('choisit le meilleur taux mesuré, pas le nom du modèle', () => {
    const runs = [
      { at: 1, model: 'alpha:3b', category, success: false },
      { at: 2, model: 'alpha:3b', category, success: true },
      { at: 3, model: 'beta:4b', category, success: true },
      { at: 4, model: 'beta:4b', category, success: true },
      { at: 5, model: 'beta:4b', category, success: true },
    ];
    const pick = pickModelFromRunMemory(installed, category, runs);
    expect(pick).toMatchObject({ model: 'beta:4b', successes: 3, attempts: 3, explored: false });
  });

  it('sans historique : exploration stable (ordre alphabétique)', () => {
    const pick = pickModelFromRunMemory(installed, category, []);
    expect(pick).toMatchObject({ model: 'alpha:3b', explored: true });
  });

  it('appendModelRun borne la taille', () => {
    let runs = [] as ReturnType<typeof appendModelRun>;
    for (let i = 0; i < 300; i += 1) {
      runs = appendModelRun(runs, {
        model: 'alpha:3b',
        category,
        success: true,
      });
    }
    expect(runs.length).toBeLessThanOrEqual(240);
  });
});
