import { describe, expect, it } from 'vitest';
import { collapseRepeatedSentences } from './transcriptCleanup.js';

describe('collapseRepeatedSentences', () => {
  it('ramène une boucle de Whisper à une seule phrase', () => {
    const loop = Array(6).fill("Qu'est-ce que c'est que ça?").join(' ');
    expect(collapseRepeatedSentences(loop)).toBe("Qu'est-ce que c'est que ça?");
    expect(collapseRepeatedSentences('Quel jour on est? Quel jour on est?')).toBe('Quel jour on est?');
    expect(collapseRepeatedSentences('Quel jour on est ? quel jour on est !')).toBe('Quel jour on est ?');
  });

  it('garde deux phrases différentes, et une phrase seule telle quelle', () => {
    expect(collapseRepeatedSentences('Quelle heure est-il ? Et demain ?')).toBe('Quelle heure est-il ? Et demain ?');
    expect(collapseRepeatedSentences('Mets de la musique sur la Devialet.')).toBe('Mets de la musique sur la Devialet.');
    expect(collapseRepeatedSentences('  ')).toBe('');
    expect(collapseRepeatedSentences('Oui. Non. Oui.')).toBe('Oui. Non. Oui.');
  });
});
