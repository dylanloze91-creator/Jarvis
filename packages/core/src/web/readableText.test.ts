import { describe, expect, it } from 'vitest';
import { extractReadableText } from './readableText.js';

describe('extractReadableText', () => {
  it('retire les balises et récupère le titre', () => {
    const html = `
      <html>
        <head><title>Exemple &amp; test</title></head>
        <body>
          <script>console.log('ignoré');</script>
          <h1>Titre</h1>
          <p>Premier paragraphe.</p>
          <p>Second paragraphe avec un&nbsp;espace protégé.</p>
        </body>
      </html>
    `;

    const result = extractReadableText(html);

    expect(result.title).toBe('Exemple & test');
    expect(result.text).toContain('Titre');
    expect(result.text).toContain('Premier paragraphe.');
    expect(result.text).toContain('Second paragraphe avec un espace protégé.');
    expect(result.text).not.toContain('ignoré');
    expect(result.truncated).toBe(false);
  });

  it('retire les styles et scripts sans laisser leur contenu', () => {
    const html = '<style>body { color: red; }</style><p>Contenu visible</p>';
    const result = extractReadableText(html);
    expect(result.text).toBe('Contenu visible');
  });

  it('tronque les pages trop longues et le signale', () => {
    const html = `<p>${'a'.repeat(100)}</p>`;
    const result = extractReadableText(html, 20);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(21);
    expect(result.text.endsWith('…')).toBe(true);
  });

  it('décode les entités numériques', () => {
    const html = '<p>Prix&#160;: 10&#8364;</p>';
    const result = extractReadableText(html);
    expect(result.text).toContain('€');
  });

  it('gère une page vide sans planter', () => {
    const result = extractReadableText('');
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
  });
});
