import { describe, expect, it } from 'vitest';
import { appendRate, entryFromDetection, parseRates, serializeRates, trimRates } from './store.js';
import type { RateDetection, RateEntry } from './types.js';

/** Phrases synthétiques marquées synthetique-test. Aucune n'est une vraie phrase de l'utilisateur. */
function detection(partial: Partial<RateDetection> = {}): RateDetection {
  return {
    type: 'correction',
    rule: 'correction-classify',
    userText: 'Non, c’est faux',
    replyText: 'Il est 3 heures.',
    team: 'horloge',
    model: 'sans modèle',
    how: 'express',
    tools: [],
    durations: {},
    ...partial,
  };
}

function entry(id: string, reviewed: boolean): RateEntry {
  return {
    ...entryFromDetection({
      id,
      at: 1_700_000_000_000 + id.length,
      edition: 'test',
      place: { kind: 'fenetre' },
      conversationId: 'conv',
      detection: detection({ userText: id }),
    }),
    reviewed,
  };
}

describe('carnet — fichier (synthetique-test)', () => {
  it('synthetique-test masque les secrets et coupe la réponse à 300 caractères', () => {
    const saved = entryFromDetection({
      at: 1_700_000_000_000,
      edition: 'test',
      place: { kind: 'enceinte', name: 'Cuisine' },
      conversationId: 'conv',
      detection: detection({
        userText: 'Non, la clé sk-abc123456789 est fausse',
        replyText: `sk-abcdefghijklmnopqrstuvwxyz ${'a'.repeat(400)}`,
        tools: [{ name: 'web_search', status: 'error', line: 'x-api-key: abcdef0123456789' }],
      }),
    });
    expect(saved.version).toBe(1);
    expect(saved.userText).not.toContain('sk-abc123456789');
    expect(saved.userText).toContain('[REDACTED]');
    expect(saved.replyStart.length).toBeLessThanOrEqual(300);
    expect(saved.replyStart).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(saved.tools[0]?.result).toBe('x-api-key: [REDACTED]');
    expect(saved.source).toEqual({ kind: 'enceinte', name: 'Cuisine' });
    const again = parseRates(serializeRates([saved]));
    expect(again).toEqual([saved]);
  });

  it('synthetique-test plafond : les plus anciennes déjà revues partent en premier', () => {
    const reviewedA = entry('a', true);
    const freshB = entry('b', false);
    const reviewedC = entry('c', true);
    const added = entry('d', false);
    expect(trimRates([reviewedA, freshB, reviewedC], 2).map((item) => item.id)).toEqual(['b', 'c']);
    expect(appendRate([reviewedA, freshB, reviewedC], added, 3).map((item) => item.id)).toEqual([
      'b',
      'c',
      'd',
    ]);
  });

  it('synthetique-test plafond : sans revue, les plus anciennes partent', () => {
    const rows = ['a', 'b', 'c'].map((id) => entry(id, false));
    expect(appendRate(rows, entry('d', false), 3).map((item) => item.id)).toEqual(['b', 'c', 'd']);
  });

  it('synthetique-test une ligne illisible est ignorée', () => {
    const saved = entry('ok', false);
    expect(parseRates(`${serializeRates([saved])}pas du json\n{"version":2,"id":"x"}\n`)).toEqual([
      saved,
    ]);
  });
});
