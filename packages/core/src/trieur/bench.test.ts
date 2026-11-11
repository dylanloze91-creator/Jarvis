import { describe, expect, it } from 'vitest';
import { ORCHESTRA_TEAMS } from '../agent/orchestraTeams.js';
import { availableTeams } from '../agent/orchestra.js';
import { BENCH_TOOLS, benchModel, benchSummaryText, type RouterModel } from './bench.js';
import type { ExamLine } from './extract.js';

describe('trieur bench', () => {
  it('propose toutes les équipes du chef d’orchestre au modèle, Musique et Images comprises', () => {
    const teams = availableTeams(BENCH_TOOLS);
    expect(teams).toEqual([...ORCHESTRA_TEAMS]);
  });

  it('compte confusions et illisibles avec un faux Ollama', async () => {
    const exam: ExamLine[] = [
      { phrase: 'Ouvre Chrome', context: 'Demande : Ouvre Chrome\nÉquipe :', team: 'pc' },
      { phrase: 'Bonjour', context: 'Demande : Bonjour\nÉquipe :', team: 'conversation' },
    ];
    const model: RouterModel = {
      name: 'fake',
      async complete(input) {
        if (input.user.includes('Chrome')) return { text: 'pc' };
        return { text: 'blabla' };
      },
    };
    const report = await benchModel(model, exam);
    expect(report.correct).toBe(1);
    expect(report.unreadable).toBe(1);
    expect(report.confusion.pc?.pc).toBe(1);
  });

  it('affiche les scores trié à froid et validé en direct séparément', () => {
    const text = benchSummaryText({
      at: '2026-11-04T00:00:00.000Z',
      examLines: 2,
      liveExamLines: 1,
      models: [
        {
          model: 'fake',
          skipped: null,
          total: 2,
          correct: 1,
          byTeam: {},
          confusion: {},
          unreadable: 0,
          loadMs: null,
          meanPhraseMs: null,
          gpuFraction: null,
        },
      ],
      liveModels: [
        {
          model: 'fake',
          skipped: null,
          total: 1,
          correct: 1,
          byTeam: {},
          confusion: {},
          unreadable: 0,
          loadMs: null,
          meanPhraseMs: null,
          gpuFraction: null,
        },
      ],
    });
    expect(text).toContain('trié à froid');
    expect(text).toContain('validé en direct');
  });
});
