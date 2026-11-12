import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pickLatestRouterScore, routerScoreFromBench, type MeasuredBench } from './score.js';

describe('score du trieur à côté du réglage', () => {
  it('42 % et 70 % sur les phrases Jarvis, et l’avis de garder le cerveau', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), '../../../../rapports/2026-11-11-trieur-banc-jarvis.json');
    const report = JSON.parse(readFileSync(file, 'utf8')) as MeasuredBench;
    expect(routerScoreFromBench(report)).toEqual({
      line: 'Trieur : 42 % de bonnes équipes sur tes phrases. Le cerveau : 70 %.',
      advice: 'Pour l’instant, garde le cerveau.',
    });
  });

  it('préfère l’examen Jarvis au banc synthétique plus récent, et un fichier userData s’il existe', () => {
    const jarvis = {
      name: 'rapports/2026-11-11-trieur-banc-jarvis.json',
      at: '2026-11-11T14:49:19.073Z',
      exam: 'jarvis',
      models: [
        { model: 'qwen2.5:7b', correct: 76, total: 108 },
        { model: 'jarvis-trieur', correct: 45, total: 108 },
      ],
    };
    const synthetic = {
      name: 'rapports/2026-11-11-trieur-banc-corrige.json',
      at: '2026-11-11T14:50:48.658Z',
      models: [
        { model: 'qwen2.5:7b', correct: 51, total: 140 },
        { model: 'jarvis-trieur', correct: 35, total: 140 },
      ],
    };
    expect(pickLatestRouterScore([synthetic, jarvis])?.line).toContain('42 %');
    const pinned = {
      name: 'trieur-dernier-score.json',
      at: '2026-11-01T00:00:00.000Z',
      models: [
        { model: 'qwen2.5:7b', correct: 10, total: 10 },
        { model: 'jarvis-trieur', correct: 9, total: 10 },
      ],
    };
    expect(pickLatestRouterScore([jarvis, pinned])?.line).toContain('90 %');
  });

  it('ne dit rien s’il n’y a pas les deux modèles', () => {
    expect(routerScoreFromBench({ models: [{ model: 'jarvis-trieur', correct: 1, total: 2 }] })).toBeNull();
  });
});
