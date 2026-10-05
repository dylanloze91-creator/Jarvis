import { describe, expect, it } from 'vitest';
import { buildValidatedFix, canSaveValidatedFix } from './learning.js';

describe('canSaveValidatedFix', () => {
  const base = {
    learningEnabled: true,
    reportVerdict: 'success' as const,
    repeatedFailure: false,
    reviewBlockingCount: 0,
    hadNewFailures: true,
  };

  it('refuse si les tests ne sont pas verts', () => {
    expect(canSaveValidatedFix({ ...base, reportVerdict: 'failed' }).ok).toBe(false);
    expect(canSaveValidatedFix({ ...base, reportVerdict: 'stopped' }).ok).toBe(false);
  });

  it('refuse si arrêt net (échec répété)', () => {
    expect(canSaveValidatedFix({ ...base, repeatedFailure: true }).ok).toBe(false);
  });

  it('refuse si revue bloquante', () => {
    expect(canSaveValidatedFix({ ...base, reviewBlockingCount: 1 }).ok).toBe(false);
  });

  it('refuse si apprentissage coupé', () => {
    expect(canSaveValidatedFix({ ...base, learningEnabled: false }).ok).toBe(false);
  });

  it('accepte une mission verte après échecs corrigés', () => {
    expect(canSaveValidatedFix(base).ok).toBe(true);
  });

  it('refuse le succès sans échec préalable (rien à apprendre)', () => {
    expect(canSaveValidatedFix({ ...base, hadNewFailures: false }).ok).toBe(false);
  });
});

describe('buildValidatedFix', () => {
  it('produit une fiche avec signature et fichiers', () => {
    const fix = buildValidatedFix({
      missionKind: 'modify',
      request: 'Accélère la balle',
      model: 'qwen3.5:4b',
      templateId: 'web-game',
      planSummary: 'Modifier src/rules.ts',
      filesTouched: ['src/rules.ts'],
      testSuites: ['test'],
      runs: [{ newFailures: ['vitest src/game.test.ts TS2588'] }, { newFailures: [] }],
      now: 1_700_000_000_000,
    });
    expect(fix.id).toBeTruthy();
    expect(fix.errorSignature).toContain('TS2588');
    expect(fix.filesTouched).toEqual(['src/rules.ts']);
  });
});
