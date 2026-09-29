import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCaptionPayload } from './captions.js';

const fixtures = dirname(fileURLToPath(import.meta.url));

describe('sous-titres YouTube', () => {
  it('lit le XML et le JSON de fixture sans couper le texte', () => {
    const xml = readFileSync(join(fixtures, 'fixtures/captions.xml'), 'utf8');
    const json = readFileSync(join(fixtures, 'fixtures/captions.json'), 'utf8');

    expect(parseCaptionPayload(xml)).toBe(
      "Bonjour à tous. L'essentiel & le point n'est pas ailleurs.",
    );
    expect(parseCaptionPayload(json)).toBe('Bonjour à tous. Le point important est la synthèse.');
  });

  it('lit aussi le XML srv3 (balises p et s)', () => {
    const xml =
      '<timedtext><body><p t="0"><s>Le CAC</s><s> vaut 7200</s></p><p t="1"><s>points.</s></p></body></timedtext>';
    expect(parseCaptionPayload(xml)).toBe('Le CAC vaut 7200 points.');
  });
});
