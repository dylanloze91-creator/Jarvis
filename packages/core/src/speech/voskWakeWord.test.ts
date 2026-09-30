import { describe, expect, it } from 'vitest';
import { voskGrammar, voskMinConfidence, voskWakeHits, voskWakeWindow } from './voskWakeWord.js';

describe('Vosk : « Jarvis » seul', () => {
  it('ferme la grammaire sur Jarvis, ses leurres et [unk]', () => {
    const grammar = voskGrammar('Jarvis');
    expect(grammar[0]).toBe('jarvis');
    expect(grammar).toContain('gervais');
    expect(grammar).toContain("j'avais");
    expect(grammar.at(-1)).toBe('[unk]');
    expect(voskGrammar('ordinateur')).toEqual(['ordinateur', '[unk]']);
  });

  it('exige une confiance de 0,9 à la sensibilité par défaut', () => {
    expect(voskMinConfidence(0.7)).toBeCloseTo(0.9, 5);
    expect(voskMinConfidence(1)).toBeCloseTo(0.87, 5);
    expect(voskMinConfidence(0)).toBeCloseTo(0.97, 5);
  });

  it('ne garde que le mot de réveil assez sûr, pas les leurres ni [unk]', () => {
    const result = {
      text: 'jarvis [unk] parvis jarvis',
      result: [
        { word: 'jarvis', conf: 1, start: 0.44, end: 0.93 },
        { word: '[unk]', conf: 0.7, start: 1.4, end: 2.0 },
        { word: 'parvis', conf: 0.95, start: 2.1, end: 2.5 },
        { word: 'jarvis', conf: 0.63, start: 3.1, end: 3.6 },
      ],
    };
    expect(voskWakeHits(result, 'jarvis', 0.9)).toEqual([{ word: 'jarvis', conf: 1, start: 0.44, end: 0.93 }]);
    expect(voskWakeHits({ text: '' }, 'jarvis', 0.9)).toEqual([]);
    expect(voskWakeHits(null, 'jarvis', 0.9)).toEqual([]);
  });

  it('donne la fenêtre de dictée : juste avant le mot, jusqu’à maintenant', () => {
    const window = voskWakeWindow({ word: 'jarvis', conf: 1, start: 10.44, end: 10.93 }, 16000 * 12, 16000);
    expect(window.startSample).toBe(Math.round((10.44 - 0.25) * 16000));
    expect(window.commandOffset).toBe(Math.round(10.93 * 16000) - window.startSample);
    expect(voskWakeWindow({ word: 'jarvis', conf: 1, start: 0.1, end: 0.5 }, 16000, 16000).startSample).toBe(0);
  });
});
