import { describe, expect, it } from 'vitest';
import { encodeQr, qrSvgPath } from './qrCode.js';

const row = (modules: boolean[][], y: number): string => modules[y]!.map((dark) => (dark ? '1' : '0')).join('');
const darkCount = (modules: boolean[][]): number => modules.flat().filter(Boolean).length;

/**
 * Valeurs relevées sur des QR codes lus avec succès par le décodeur d'OpenCV (5.0.63) : textes
 * courts, adresse de jumelage, accents et emoji, versions 1, 2, 4, 6, 8 et 10.
 */
describe('QR code', () => {
  it('« A » : version 1, masque 3, modules identiques au code relu', () => {
    const qr = encodeQr('A');
    expect(qr).toMatchObject({ version: 1, size: 21, mask: 3 });
    expect(darkCount(qr.modules)).toBe(226);
    expect(row(qr.modules, 0)).toBe('111111101001001111111');
    expect(row(qr.modules, 20)).toBe('111111101000010010000');
  });

  it('adresse de jumelage : version 4', () => {
    const qr = encodeQr('https://pc-de-dylan.tail1a2b3c.ts.net/#code=123456');
    expect(qr).toMatchObject({ version: 4, size: 33, mask: 2 });
    expect(darkCount(qr.modules)).toBe(555);
    expect(row(qr.modules, 0)).toBe('111111100001010011111101101111111');
  });

  it('UTF-8 : accents et symboles', () => {
    const qr = encodeQr('Bonjour Jarvis éèà ✓');
    expect(qr).toMatchObject({ version: 2, mask: 6 });
    expect(darkCount(qr.modules)).toBe(340);
  });

  it('versions avec bloc de version (7 et plus) et limite', () => {
    expect(encodeQr('z'.repeat(150)).version).toBe(8);
    expect(encodeQr('w'.repeat(210)).version).toBe(10);
    expect(() => encodeQr('v'.repeat(300))).toThrow('trop long');
  });

  it('repères de position dans les trois coins', () => {
    const { modules, size } = encodeQr('repères');
    for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
      expect(modules[y]![x]).toBe(true);
      expect(modules[y + 1]![x + 1]).toBe(false);
      expect(modules[y + 3]![x + 3]).toBe(true);
    }
  });

  it('chemin SVG : une case par module noir, marge comprise', () => {
    const qr = encodeQr('A');
    const path = qrSvgPath(qr);
    expect(path.match(/h1v1h-1z/g)).toHaveLength(darkCount(qr.modules));
    expect(path.startsWith('M4 4')).toBe(true);
  });
});
