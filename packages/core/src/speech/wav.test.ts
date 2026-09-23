import { describe, expect, it } from 'vitest';
import { concatFloat32, encodeWav } from './wav.js';

describe('concatFloat32', () => {
  it('concatène plusieurs trames dans l’ordre', () => {
    const result = concatFloat32([new Float32Array([1, 2]), new Float32Array([3, 4, 5])]);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gère un tableau vide', () => {
    expect(concatFloat32([])).toHaveLength(0);
  });
});

describe('encodeWav', () => {
  it('écrit un en-tête RIFF/WAVE valide', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWav(samples, 16000);
    const view = new DataView(wav.buffer);

    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(readAscii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sampleRate
    expect(view.getUint16(34, true)).toBe(16); // bits par échantillon
    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(wav).toHaveLength(44 + samples.length * 2);
  });

  it('convertit les échantillons flottants en PCM 16 bits cohérent', () => {
    const wav = encodeWav(new Float32Array([1, -1, 0]), 8000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0);
  });
});

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}
