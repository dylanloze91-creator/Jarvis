import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { liensVersPlans } from './atelierPC.js';
import { texteDuPdf } from './pdfTexte.js';

/**
 * Le texte d'un PDF, sans bibliothèque. Les PDF sont fabriqués ici (le texte est inventé) : un flux
 * compressé, une police avec sa table ToUnicode (codes sur deux octets), et un PDF sans texte.
 */
function pdf(objets: (string | { dict: string; flux: Buffer })[]): Uint8Array {
  const morceaux: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
  objets.forEach((o, i) => {
    if (typeof o === 'string') morceaux.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
    else morceaux.push(Buffer.from(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.flux.length} >>\nstream\n`, 'latin1'), o.flux, Buffer.from('\nendstream\nendobj\n', 'latin1'));
  });
  morceaux.push(Buffer.from('trailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  return new Uint8Array(Buffer.concat(morceaux));
}

describe('texte d’un PDF', () => {
  it('flux compressé, police simple : les lignes de la fiche', () => {
    const contenu = deflateSync(Buffer.from('BT /F1 10 Tf 72 700 Td (Outline Dimension 35.40 x 33.50 mm) Tj 0 -14 Td [(Active) -300 (Area 29.42) ] TJ ET', 'latin1'));
    const t = texteDuPdf(
      pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        { dict: '/Filter /FlateDecode', flux: contenu },
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ]),
    );
    expect(t).toBe('Outline Dimension 35.40 x 33.50 mm\nActive Area 29.42');
  });

  it('police à codes sur deux octets : lue par sa table ToUnicode', () => {
    const cmap = Buffer.from('begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n2 beginbfchar\n<0001> <0050>\n<0002> <0043>\nendbfchar\n1 beginbfrange\n<0003> <0004> <0042>\nendbfrange\nendcmap', 'latin1');
    const t = texteDuPdf(
      pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F2 5 0 R >> >> /Contents 4 0 R >>',
        { dict: '', flux: Buffer.from('BT /F2 9 Tf <0001000200030004> Tj ET', 'latin1') },
        '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 6 0 R >>',
        { dict: '/Filter /FlateDecode', flux: deflateSync(cmap) },
      ]),
    );
    expect(t).toBe('PCBC');
  });

  it('un plan dessiné en traits, ou pas un PDF : rien (jamais deviné)', () => {
    const dessin = pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
      { dict: '', flux: Buffer.from('0 0 m 100 0 l S 10 10 m 10 50 l S', 'latin1') },
    ]);
    expect(texteDuPdf(dessin)).toBe('');
    expect(texteDuPdf(new TextEncoder().encode('0\nSECTION\n'))).toBe('');
  });
});

describe('liens d’une page vers des plans', () => {
  it('DXF et PDF, adresses complètes, texte du lien ; le reste ignoré', () => {
    const html =
      '<a href="../dl/DXF_carte.dxf">Dimensions <b>DXF</b></a> <a href="https://x.test/fiche.pdf?v=2">Datasheet</a> <a href="/page.html">Page</a> <a href="javascript:alert(1).pdf">x</a>';
    expect(liensVersPlans(html, 'https://fab.test/docs/guide.html')).toEqual([
      { url: 'https://fab.test/dl/DXF_carte.dxf', texte: 'Dimensions DXF' },
      { url: 'https://x.test/fiche.pdf?v=2', texte: 'Datasheet' },
    ]);
  });
});
