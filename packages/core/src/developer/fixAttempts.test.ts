import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import {
  MAX_FIX_ATTEMPTS,
  MAX_TEST_SERIES,
  maxTestSeriesFor,
  resolveMaxFixAttempts,
} from './taskPlan.js';
import { approvalFromPlan, planCoverage, type ReviewedPlan } from './taskPolicy.js';

const plan: ReviewedPlan = {
  summary: 'Ajouter une constante.',
  criteria: [],
  files: [
    { path: 'src/a.ts', action: 'edit', reason: '', core: null, exists: true, problem: null },
  ],
  tests: ['typecheck'],
};

describe('réglage developer.maxFixAttempts (0.5.0)', () => {
  it('absent : 3 corrections et 5 séries de tests, comme en 0.4.26', () => {
    const developer = parseSettings({}).developer;
    expect(developer).not.toHaveProperty('maxFixAttempts');
    expect(resolveMaxFixAttempts(developer.maxFixAttempts)).toBe(3);
    expect(MAX_FIX_ATTEMPTS).toBe(3);
    expect(maxTestSeriesFor(MAX_FIX_ATTEMPTS)).toBe(MAX_TEST_SERIES);
    expect(approvalFromPlan(plan, 'jarvis-dev/2026-10-03-a').maxTestSeries).toBe(5);
  });

  it('de 1 à 5, lu tel quel', () => {
    for (const value of [1, 2, 3, 4, 5]) {
      const developer = parseSettings({ developer: { maxFixAttempts: value } }).developer;
      expect(developer.maxFixAttempts).toBe(value);
      expect(resolveMaxFixAttempts(developer.maxFixAttempts)).toBe(value);
    }
  });

  it('hors bornes : la valeur précédente est gardée, le reste du bloc aussi', () => {
    const previous = parseSettings({
      developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', maxFixAttempts: 4 },
    });
    for (const bad of [0, 6, 2.5, '3', -1]) {
      const parsed = parseSettings(
        { ...previous, developer: { ...previous.developer, maxFixAttempts: bad } },
        previous,
      );
      expect(parsed.developer).toEqual(previous.developer);
    }
    expect(resolveMaxFixAttempts(0)).toBe(3);
    expect(resolveMaxFixAttempts(6)).toBe(3);
    expect(resolveMaxFixAttempts(2.5)).toBe(3);
  });

  it('la validation du plan couvre essais + 2 séries de tests, pas une de plus', () => {
    const approval = approvalFromPlan(plan, 'jarvis-dev/2026-10-03-a', 1);
    expect(approval.maxTestSeries).toBe(3);
    expect(planCoverage(approval, { kind: 'tests', suite: 'typecheck', series: 3 }).covered).toBe(
      true,
    );
    expect(planCoverage(approval, { kind: 'tests', suite: 'typecheck', series: 4 })).toEqual({
      covered: false,
      reason: 'plus de 3 séries de tests',
    });
    expect(approvalFromPlan(plan, 'jarvis-dev/2026-10-03-a', 5).maxTestSeries).toBe(7);
  });
});
