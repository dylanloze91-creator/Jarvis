import { describe, expect, it } from 'vitest';
import { detectVideoDomain } from './domain.js';

describe('domaine de la vidéo', () => {
  it('passe en finance quand plusieurs termes du domaine sont présents', () => {
    const text =
      'La bourse, les actions, le dividende et un ETF du CAC 40. Le rendement suit l’inflation.';
    expect(detectVideoDomain(text)).toBe('finance');
  });

  it('reste général sans assez de termes, et ne prend pas « per » dans un autre mot', () => {
    expect(detectVideoDomain('Une personne permet de comprendre le sujet.')).toBe('general');
    expect(detectVideoDomain('Le CAC est à 7200 points selon la séance.')).toBe('general');
  });
});
