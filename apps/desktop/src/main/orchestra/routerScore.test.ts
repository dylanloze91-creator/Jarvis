import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRouterScore } from './routerScore.js';

const jarvisBench = {
  at: '2026-11-11T14:49:19.073Z',
  exam: 'jarvis',
  models: [
    { model: 'qwen2.5:7b', correct: 76, total: 108 },
    { model: 'jarvis-trieur', correct: 45, total: 108 },
  ],
};

describe('lecture du dernier score', () => {
  it('lit le banc Jarvis : 42 % pour le trieur, 70 % pour le cerveau', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-score-'));
    await writeFile(join(dir, '2026-11-11-trieur-banc-jarvis.json'), JSON.stringify(jarvisBench));
    const score = await readRouterScore([dir]);
    expect(score).toEqual({
      line: 'Trieur : 42 % de bonnes équipes sur tes phrases. Le cerveau : 70 %.',
      advice: 'Pour l’instant, garde le cerveau.',
    });
  });

  it('un fichier userData plus ancien mais nommé dernier score passe devant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-score-'));
    await writeFile(join(dir, '2026-11-11-trieur-banc-jarvis.json'), JSON.stringify(jarvisBench));
    await writeFile(
      join(dir, 'trieur-dernier-score.json'),
      JSON.stringify({
        at: '2026-11-01T00:00:00.000Z',
        models: [
          { model: 'qwen2.5:7b', correct: 8, total: 10 },
          { model: 'jarvis-trieur', correct: 3, total: 10 },
        ],
      }),
    );
    const score = await readRouterScore([dir]);
    expect(score?.line).toBe('Trieur : 30 % de bonnes équipes sur tes phrases. Le cerveau : 80 %.');
    expect(score?.advice).toBe('Pour l’instant, garde le cerveau.');
  });

  it('ne renvoie rien si aucun rapport', async () => {
    expect(await readRouterScore([join(tmpdir(), 'jarvis-score-absent')])).toBeNull();
  });
});
