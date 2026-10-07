import { describe, expect, it } from 'vitest';
import { refineFrenchDictation } from './dictationPhoneticFix.js';

describe('refineFrenchDictation', () => {
  it('corrige « ouf chrome » en « ouvre Chrome »', () => {
    expect(refineFrenchDictation("Jarvis, ouf, chrome.")).toBe('Jarvis, ouvre Chrome.');
    expect(refineFrenchDictation("Jarvis, Ouv Chrome.")).toBe('Jarvis, ouvre Chrome.');
    expect(refineFrenchDictation("J'avis ouf crôme")).toBe("J'avis ouvre Chrome");
  });

  it('laisse une phrase déjà correcte intacte', () => {
    expect(refineFrenchDictation('Jarvis, ouvre Chrome.')).toBe('Jarvis, ouvre Chrome.');
  });
});
