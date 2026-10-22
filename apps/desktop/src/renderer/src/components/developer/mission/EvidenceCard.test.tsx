import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { judgeMissionEvidence } from '@jarvis/core';
import { EvidenceCard } from './EvidenceCard';

describe('carte de preuve', () => {
  it('montre un succès déclaré sans exécution, et le motif de rejet', () => {
    const evidence = judgeMissionEvidence({
      id: 'declare',
      at: 1,
      goal: 'corriger le score',
      passCriteria: ['les tests passent'],
      kind: 'programming',
      declaredSuccess: true,
      checks: [
        {
          name: 'test',
          kind: 'test',
          required: true,
          ran: false,
          passed: null,
          exitCode: null,
          testsRan: null,
          reason: 'test n’a pas été lancé.',
        },
      ],
      commands: [{ command: 'npm test', exitCode: null }],
    });
    const html = renderToStaticMarkup(<EvidenceCard evidence={evidence} />);
    expect(html).toContain('data-mission-evidence="unverified"');
    expect(html).toContain('Non vérifié');
    expect(html).toContain('non lancé');
    expect(html).toContain('data-evidence-staging="rejected"');
    expect(html).toContain('Inspecter la preuve');
  });
});
