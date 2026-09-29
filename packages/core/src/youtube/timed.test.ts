import { describe, expect, it } from 'vitest';
import { formatMediaTimestamp, joinTimedParts } from './timed.js';

describe('horodatage des tranches', () => {
  it('écrit les minutes et les heures', () => {
    expect(formatMediaTimestamp(60)).toBe('1:00');
    expect(formatMediaTimestamp(90)).toBe('1:30');
    expect(formatMediaTimestamp(3600)).toBe('1:00:00');
  });

  it('préfixe chaque tranche et ignore une tranche vide', () => {
    expect(
      joinTimedParts([
        { startSeconds: 0, endSeconds: 30, text: '  Le CAC est à 7200 points. ' },
        { startSeconds: 30, endSeconds: 45, text: '   ' },
        { startSeconds: 45, endSeconds: 60, text: 'Dupont est cité.' },
      ]),
    ).toBe('[0:00 → 0:30] Le CAC est à 7200 points.\n[0:45 → 1:00] Dupont est cité.');
  });
});
