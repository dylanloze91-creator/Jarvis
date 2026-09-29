import { describe, expect, it } from 'vitest';
import { splitTranscript } from './chunk.js';

describe('découpe de transcription', () => {
  it('garde un texte court en un seul morceau', () => {
    expect(splitTranscript('Le CAC clôture à 7200 points.', 2000)).toEqual([
      'Le CAC clôture à 7200 points.',
    ]);
    expect(splitTranscript('   ')).toEqual([]);
  });

  it('coupe une longue transcription sur les phrases sans en perdre', () => {
    const sentences = Array.from(
      { length: 30 },
      (_, index) => `Phrase ${index} parle du marché et d'un chiffre ${1000 + index}.`,
    );
    const source = sentences.join(' ');
    const chunks = splitTranscript(source, 180);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 180)).toBe(true);
    const rebuilt = chunks.join(' ');
    for (const sentence of sentences) {
      expect(rebuilt).toContain(sentence);
    }
  });

  it('garde chaque passage horodaté dans sa partie', () => {
    const text = '[0:00 → 0:30] Première séance calme. [0:30 → 1:00] Deuxième séance calme.';
    expect(splitTranscript(text, 500)).toEqual([text]);
    const chunks = splitTranscript(text, 40);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('[0:00 → 0:30]');
    expect(chunks[0]).not.toContain('[0:30 → 1:00]');
    expect(chunks[1]).toContain('[0:30 → 1:00]');
  });
});
