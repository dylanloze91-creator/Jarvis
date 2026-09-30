import { describe, expect, it } from 'vitest';
import { ATTENUATED_PEAK, attenuateClipping } from './voiceGain.js';
import { scaleOpenWakeWordPcm } from './openWakeWord.js';

describe('atténuation quand la crête atteint le plein échelle', () => {
  it('ramène une crête ≥ 1 sous 1, sans changer la forme', () => {
    const pcm = new Float32Array([0.2, -1.001, 0.5]);
    const result = attenuateClipping(pcm);
    expect(result.applied).toBe(true);
    expect(result.peak).toBeCloseTo(1.001, 5);
    expect(result.pcm).not.toBe(pcm);
    expect(Math.max(...Array.from(result.pcm, Math.abs))).toBeCloseTo(ATTENUATED_PEAK, 5);
    expect(result.pcm[1]).toBeCloseTo(-ATTENUATED_PEAK, 5);
    expect(result.pcm[0]! / result.pcm[1]!).toBeCloseTo(0.2 / -1.001, 4);
  });

  it('laisse intact un signal déjà sous le plein échelle', () => {
    const pcm = new Float32Array([0.2, -0.4, 0]);
    const result = attenuateClipping(pcm);
    expect(result.applied).toBe(false);
    expect(result.pcm).toBe(pcm);
    expect(result.peak).toBeCloseTo(0.4, 5);
  });

  it('échelle openWakeWord : 16 bits, jamais collé à ±32767 après une crête saturée', () => {
    const scaled = scaleOpenWakeWordPcm(new Float32Array([1.001, -0.5]));
    expect(scaled[0]).toBeCloseTo(ATTENUATED_PEAK * 32767, 0);
    expect(Math.abs(scaled[0]!)).toBeLessThan(32767);
    expect(scaled[1]).toBeCloseTo(((-0.5 * ATTENUATED_PEAK) / 1.001) * 32767, 0);
  });

  it('porte un signal dans [-1, 1) à l’échelle int16, pas des flottants unitaires', () => {
    const scaled = scaleOpenWakeWordPcm(new Float32Array([0.5, -0.25, 0]));
    expect(scaled[0]).toBeCloseTo(0.5 * 32767, 0);
    expect(scaled[1]).toBeCloseTo(-0.25 * 32767, 0);
    expect(scaled[2]).toBe(0);
    expect(Math.abs(scaled[0]!)).toBeGreaterThan(1000);
  });
});
