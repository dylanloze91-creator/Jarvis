import { describe, expect, it } from 'vitest';
import { planScopeWarnings } from './planScope.js';

describe('planScopeWarnings', () => {
  it('signale des critères vides', () => {
    const w = planScopeWarnings('Ajoute un test formatSeconds', {
      summary: 'Ajoute un test pour formatSeconds',
      criteria: [],
    });
    expect(w.some((line) => line.includes('critères'))).toBe(true);
  });

  it('signale une dérive évidente', () => {
    const w = planScopeWarnings('Corrige le benchmark Pong uniquement', {
      summary: 'Réécrire toute l’application en React',
      criteria: ['Nouvelle UI'],
    });
    expect(w.some((line) => line.includes('demande'))).toBe(true);
  });
});
