import { describe, expect, it } from 'vitest';
import { normalizePiperStdinText } from './piperInput.js';

describe('normalizePiperStdinText', () => {
  it('fusionne retours à la ligne et espaces multiples en une ligne', () => {
    expect(normalizePiperStdinText('Bonjour\n\nJarvis.\t  Suite')).toBe('Bonjour Jarvis. Suite');
  });

  it('retourne une chaîne vide si rien à dire', () => {
    expect(normalizePiperStdinText('  \n  ')).toBe('');
  });
});
