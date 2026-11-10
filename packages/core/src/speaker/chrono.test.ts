import { describe, expect, it } from 'vitest';
import {
  SpeakerChrono,
  chronoLine,
  chronoView,
  medianMs,
  readCaptureMs,
  sanitizeChronoSample,
  type SpeakerChronoSample,
} from './chrono.js';

function sample(partial: Partial<SpeakerChronoSample> = {}): SpeakerChronoSample {
  return {
    audioMs: 800,
    captureMs: null,
    transcriptionMs: 2_100,
    decisionMs: 40,
    path: 'cerveau',
    firstTextMs: 4_200,
    spokenReadyMs: 4_500,
    synthesisMs: 900,
    responseMs: 30,
    totalMs: 7_800,
    ...partial,
  };
}

describe('chrono de l’enceinte', () => {
  it('lit l’en-tête de prise de son et ignore le reste', () => {
    expect(readCaptureMs('700')).toBe(700);
    expect(readCaptureMs(undefined)).toBeNull();
    expect(readCaptureMs('bonjour')).toBeNull();
    expect(readCaptureMs('-4')).toBeNull();
    expect(readCaptureMs('9999999')).toBeNull();
  });

  it('n’écrit jamais le texte dit, même s’il est glissé dans la mesure', () => {
    const dirty = sample() as SpeakerChronoSample & { text?: string; transcript?: string };
    dirty.text = 'Le secret est dans la phrase dite à voix haute.';
    dirty.transcript = 'Jarvis, rappelle-moi le code.';
    const line = chronoLine(dirty);
    expect(line).not.toContain('secret');
    expect(line).not.toContain('Jarvis');
    expect(line).not.toContain('phrase');
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'audioMs',
        'captureMs',
        'decisionMs',
        'firstTextMs',
        'path',
        'responseMs',
        'spokenReadyMs',
        'synthesisMs',
        'totalMs',
        'transcriptionMs',
      ].sort(),
    );
    expect(parsed.path).toBe('cerveau');
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'path') expect(value).toBe('cerveau');
      else expect(value === null || typeof value === 'number').toBe(true);
    }
  });

  it('garde les 50 dernières et calcule les médianes des 20 dernières', () => {
    const lines: string[] = [];
    const chrono = new SpeakerChrono({
      append: (line) => lines.push(line),
      clear: () => lines.splice(0, lines.length),
    });
    for (let index = 0; index < 60; index += 1) {
      chrono.record(
        sample({
          transcriptionMs: index < 40 ? 100 : 2_000 + index,
          firstTextMs: 4_200,
          spokenReadyMs: 100,
          synthesisMs: 50,
          responseMs: 10,
          totalMs: 5_000,
          path: index % 2 === 0 ? 'reflexe' : 'trieur',
        }),
      );
    }
    expect(chrono.last(100)).toHaveLength(50);
    expect(lines).toHaveLength(60);
    const view = chrono.view();
    expect(view.steps.find((step) => step.id === 'firstTextMs')?.slowest).toBe(true);
    expect(view.sentence).toBe('Le plus long : la réponse du modèle, 4,2 s.');
    expect(view.steps.every((step) => Number.isFinite(step.medianMs))).toBe(true);
    chrono.reset();
    expect(chrono.view().sentence).toBe('Pas encore de phrase mesurée.');
    expect(lines).toHaveLength(0);
  });

  it('médiane paire et chemin inconnu', () => {
    expect(medianMs([1, 4, 9])).toBe(4);
    expect(medianMs([10, 20])).toBe(15);
    expect(sanitizeChronoSample(sample({ path: 'autre' as 'cerveau' })).path).toBe('cerveau');
    const view = chronoView([
      sample({ captureMs: 700, firstTextMs: null, transcriptionMs: 100, synthesisMs: 50 }),
    ]);
    expect(view.steps.some((step) => step.id === 'captureMs')).toBe(true);
    expect(view.steps.some((step) => step.id === 'firstTextMs')).toBe(false);
  });
});
