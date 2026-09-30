import { describe, expect, it } from 'vitest';
import { CircularPcmBuffer, WakeTriggerGate, slidingWindows } from './wakeBuffer.js';

describe('buffer de réveil', () => {
  it('garde le début récent et oublie le trop ancien', () => {
    const buffer = new CircularPcmBuffer(4);
    buffer.push(new Float32Array([1, 2]));
    buffer.push(new Float32Array([3, 4, 5]));
    expect(Array.from(buffer.snapshot())).toEqual([3, 4, 5]);
  });

  it('découpe des fenêtres glissantes', () => {
    const windows = slidingWindows(new Float32Array([1, 2, 3, 4, 5]), 3, 2);
    expect(windows.map((window) => Array.from(window))).toEqual([
      [1, 2, 3],
      [3, 4, 5],
    ]);
  });

  it('refuse un second déclenchement pendant le cooldown', () => {
    const gate = new WakeTriggerGate(700);
    expect(gate.allow(1000)).toBe(true);
    expect(gate.allow(1400)).toBe(false);
    expect(gate.allow(1700)).toBe(true);
  });
});
