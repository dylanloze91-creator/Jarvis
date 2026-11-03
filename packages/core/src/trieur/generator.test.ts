import { describe, expect, it } from 'vitest';
import { EXAM_CONTAMINATION_THRESHOLD, trieurTextSimilarity } from './similarity.js';
import { validateGenerated, createGenerateContext, buildTrainingLine, seedFor } from './generator.js';
import { prepareTrieurTraining } from './trainPrep.js';
import type { ExamLine } from './extract.js';
import { expressTeam } from '../agent/orchestra.js';

describe('trieur generator', () => {
  const exam: ExamLine[] = [
    { phrase: 'Phrase secrète examen', context: 'Demande : Phrase secrète examen\nÉquipe :', team: 'pc' },
  ];
  const ctx = createGenerateContext(exam);

  it('refuse contamination examen', () => {
    const seed = { ...seedFor(1), team: 'pc' as const };
    const verdict = validateGenerated({ phrase: 'Phrase secrète examen', team: 'pc' }, seed, ctx);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('examen');
  });

  it('refuse désaccord express', () => {
    const text = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(expressTeam({ text, history: [], available: new Set(ctx.teams) })).toBeTruthy();
    const seed = { ...seedFor(2), team: 'conversation' as const };
    expect(validateGenerated({ phrase: text, team: 'conversation' }, seed, ctx).ok).toBe(false);
  });

  it('accepte un exemple valide', () => {
    const seed = { ...seedFor(99, 'synthetique-test'), team: 'conversation' as const };
    const verdict = validateGenerated({ phrase: 'Explique-moi la photosynthèse', team: 'conversation' }, seed, ctx);
    expect(verdict.ok).toBe(true);
  });

  it('seuil de similarité documenté', () => {
    expect(EXAM_CONTAMINATION_THRESHOLD).toBe(0.4);
    expect(trieurTextSimilarity('bonjour jarvis', 'bonjour jarvis')).toBeGreaterThan(0.3);
  });
});

describe('trieur trainPrep', () => {
  it('écarte les lignes trop proches de l\'examen', () => {
    const exam: ExamLine[] = [{ phrase: 'unique exam', context: 'Demande : unique exam\nÉquipe :', team: 'pc' }];
    const teams = createGenerateContext(exam).teams;
    const good = JSON.stringify(buildTrainingLine('web', 'Cherche la météo demain', '', teams, seedFor(1)));
    const bad = JSON.stringify(
      buildTrainingLine('pc', 'unique exam', 'Demande : unique exam\nÉquipe :', teams, seedFor(2)),
    );
    const result = prepareTrieurTraining({ lines: [good, bad], exam, options: { minKept: 1 } });
    expect(result.setAside.some((row) => row.reason.includes('examen'))).toBe(true);
  });
});
