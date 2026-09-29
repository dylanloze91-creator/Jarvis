import { describe, expect, it } from 'vitest';
import { IMPORTANCE_RUBRIC, chunkPrompt, mergePrompt } from './rubric.js';

describe('grille d’importance', () => {
  it('garde le concret, écarte le remplissage, et interdit d’inventer un chiffre', () => {
    expect(IMPORTANCE_RUBRIC).toMatch(/faits concrets/);
    expect(IMPORTANCE_RUBRIC).toMatch(/chiffres/);
    expect(IMPORTANCE_RUBRIC).toMatch(/noms/);
    expect(IMPORTANCE_RUBRIC).toMatch(/décisions/);
    expect(IMPORTANCE_RUBRIC).toMatch(/risques/);
    expect(IMPORTANCE_RUBRIC).toMatch(/introductions/);
    expect(IMPORTANCE_RUBRIC).toMatch(/publicité/);
    expect(IMPORTANCE_RUBRIC).toMatch(/répétitions/);
    expect(IMPORTANCE_RUBRIC).toMatch(/bavardage/);
    expect(IMPORTANCE_RUBRIC).toMatch(/actif/);
    expect(IMPORTANCE_RUBRIC).toMatch(/affirmation/);
    expect(IMPORTANCE_RUBRIC).toMatch(/horizon de temps/);
    expect(IMPORTANCE_RUBRIC).toMatch(/opinion/);
    expect(IMPORTANCE_RUBRIC).toMatch(/fait/);
    expect(IMPORTANCE_RUBRIC).toMatch(/N'invente aucun chiffre/);
    expect(IMPORTANCE_RUBRIC).toMatch(/opinion ou une prévision en fait/);
    expect(IMPORTANCE_RUBRIC).toMatch(/incertitude/);
    expect(IMPORTANCE_RUBRIC).toMatch(/unité et le contexte/);
    expect(IMPORTANCE_RUBRIC).toMatch(/conseil d'investissement/);
  });

  it('passe la partie et les notes à la fusion', () => {
    expect(chunkPrompt('Le baril est à 80 dollars.', 0, 3)).toContain('Le baril est à 80 dollars.');
    expect(chunkPrompt('x', 1, 3)).toContain('Partie 2 sur 3');
    const merged = mergePrompt(['Note A 80', 'Note B']);
    expect(merged).toContain('condensé');
    expect(merged).toContain('Note A 80');
    expect(merged).toContain('Note B');
    expect(merged).toMatch(/N'invente aucun chiffre/);
  });
});
