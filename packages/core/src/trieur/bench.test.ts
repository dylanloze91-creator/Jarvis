import { describe, expect, it } from 'vitest';
import { benchModel, type RouterModel } from './bench.js';
import type { ExamLine } from './extract.js';

describe('trieur bench', () => {
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
});
