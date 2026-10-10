import { describe, expect, it } from 'vitest';
import { structureReviewerOutput } from './missionPrompts.js';

describe('structureReviewerOutput', () => {
  it('classe bloquant, important, mineur et suggestion', () => {
    const structured = structureReviewerOutput(
      {
        verdict: 'à revoir',
        issues: [
          { severity: 'bloquant', message: 'Secret en clair', file: 'a.ts', line: 1 },
          { severity: 'avertissement', message: 'Test manquant' },
          { severity: 'info', message: 'Style' },
        ],
        recommendations: ['Ajouter un commentaire'],
      },
      'qwen2.5:3b',
      1,
    );
    expect(structured.blocking).toHaveLength(1);
    expect(structured.findings.filter((f) => f.bucket === 'bloquant')).toHaveLength(1);
    expect(structured.findings.filter((f) => f.bucket === 'suggestion')).toHaveLength(1);
    expect(structured.separateCall).toBe(true);
    expect(structured.sameModelAsCoder).toBe(false);
    expect(structured.independenceNote).toContain('appel distinct');
  });

  it('signale quand le REVIEWER est le même modèle que le CODER', () => {
    const structured = structureReviewerOutput(
      { verdict: 'ok', issues: [], recommendations: [] },
      'qwen2.5:3b',
      2,
      { coderModel: 'qwen2.5:3b' },
    );
    expect(structured.sameModelAsCoder).toBe(true);
    expect(structured.independenceNote).toMatch(/même modèle|pas une relecture indépendante/i);
  });
});
