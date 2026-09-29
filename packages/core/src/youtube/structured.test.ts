import { describe, expect, it } from 'vitest';
import {
  importanceScore,
  parseVideoJson,
  proseFromModelAnalysis,
  rankNotesByImportance,
  stripImportanceLabels,
} from './structured.js';

describe('analyse structurée', () => {
  it('lit un JSON entouré de balises et retombe sur la valeur de secours', () => {
    expect(parseVideoJson<{ ok: boolean }>('```json\n{"ok":true}\n```', { ok: false })).toEqual({ ok: true });
    expect(parseVideoJson<{ ok: boolean }>('not json', { ok: false })).toEqual({ ok: false });
  });

  it('classe les notes par importance et laisse l’ordre intact sans score', () => {
    expect(importanceScore('Importance : 90\nLe bénéfice progresse.')).toBe(90);
    expect(importanceScore('{"importance": 12, "summary": "remplissage"}')).toBe(12);
    expect(
      rankNotesByImportance([
        { text: 'faible', score: 12 },
        { text: 'fort', score: 90 },
      ]),
    ).toEqual(['fort', 'faible']);
    expect(
      rankNotesByImportance([
        { text: 'a', score: null },
        { text: 'b', score: null },
      ]),
    ).toEqual(['a', 'b']);
  });

  it('transforme le JSON en phrases et ignore le score', () => {
    const prose = proseFromModelAnalysis(
      '{"importance": 95, "summary": "Le bénéfice progresse de 20 %.", "numbers": ["20 %"], "facts": []}',
    );
    expect(prose).toContain('Le bénéfice progresse de 20 %.');
    expect(prose).toContain('20 %');
    expect(prose).not.toMatch(/\b95\b/);
  });

  it('retire la ligne de score du condensé affiché', () => {
    expect(stripImportanceLabels('Importance : 80\nLe CAC est à 7200 points.')).toBe(
      'Le CAC est à 7200 points.',
    );
  });
});
