import { describe, expect, it } from 'vitest';
import { COPY_TEXT_MAX, isCopyableText } from './copyText.js';

describe('copie par le processus principal', () => {
  it('accepte un texte, comme le bloc secrets.h', () => {
    expect(isCopyableText('#define JARVIS_PORT 53131\n#define SPEAKER_NAME "chambre"\n')).toBe(true);
  });

  it('refuse le vide, ce qui n’est pas du texte, et un texte trop long', () => {
    expect(isCopyableText('')).toBe(false);
    expect(isCopyableText(undefined)).toBe(false);
    expect(isCopyableText(42)).toBe(false);
    expect(isCopyableText({ text: 'x' })).toBe(false);
    expect(isCopyableText('x'.repeat(COPY_TEXT_MAX))).toBe(true);
    expect(isCopyableText('x'.repeat(COPY_TEXT_MAX + 1))).toBe(false);
  });
});
