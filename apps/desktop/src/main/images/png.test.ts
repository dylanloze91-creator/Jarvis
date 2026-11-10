import { describe, expect, it } from 'vitest';
import { decodePng, encodeRgbaPng, toBlackAndWhitePng } from './png.js';

describe('module images — PNG noir et blanc', () => {
  it('un PNG RGBA devient deux valeurs, le transparent devient blanc', () => {
    // 2×2 : rouge vif, presque noir, blanc, transparent.
    const rgba = Buffer.from([255, 40, 40, 255, 10, 10, 10, 255, 255, 255, 255, 255, 0, 0, 0, 0]);
    const png = encodeRgbaPng(2, 2, rgba, 4);
    const bw = toBlackAndWhitePng(png);
    const decoded = decodePng(bw);
    expect(decoded).toMatchObject({ width: 2, height: 2, channels: 1 });
    expect([...decoded.pixels]).toEqual([0, 0, 255, 255]);
  });

  it('RGB sans alpha, image plus grande, filtres rejoués à l’identique', () => {
    const width = 70;
    const height = 9;
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i += 1) {
      const v = (i * 37) % 256;
      rgb[i * 3] = v;
      rgb[i * 3 + 1] = 255 - v;
      rgb[i * 3 + 2] = (v * 3) % 256;
    }
    const png = encodeRgbaPng(width, height, rgb, 3);
    const decoded = decodePng(png);
    expect(decoded.channels).toBe(3);
    expect(Buffer.from(decoded.pixels).equals(rgb)).toBe(true);
    const bw = decodePng(toBlackAndWhitePng(png, { threshold: 128 }));
    expect(new Set([...bw.pixels]).size).toBeLessThanOrEqual(2);
    expect(bw.pixels.length).toBe(width * height);
  });

  it('refuse ce qui n’est pas un PNG 8 bits pris en charge', () => {
    expect(() => toBlackAndWhitePng(Buffer.from('pas un png'))).toThrow(/PNG/);
  });
});
