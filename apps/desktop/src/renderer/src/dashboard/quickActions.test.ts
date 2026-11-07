import { describe, expect, it } from 'vitest';
import { filterQuickActionsForQuestionnaire } from './quickActions';

const QUICK = [
  { id: 'chrome', label: 'Chrome' },
  { id: 'mail', label: 'Mail', google: true },
];

describe('filterQuickActionsForQuestionnaire', () => {
  it('sans questionnaire appliqué, conserve tous les raccourcis', () => {
    expect(
      filterQuickActionsForQuestionnaire(QUICK, {
        completedAt: null,
        preferredServices: ['music'],
      }),
    ).toHaveLength(2);
  });

  it('masque la lecture d’emails si Google n’a pas été choisi', () => {
    const filtered = filterQuickActionsForQuestionnaire(QUICK, {
      completedAt: Date.now(),
      preferredServices: ['music', 'web'],
    });
    expect(filtered.map((item) => item.id)).toEqual(['chrome']);
  });
});
