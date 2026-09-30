import { describe, expect, it } from 'vitest';
import { CAPTURE_WORKLET_SOURCE } from './audioCapture';

function loadProcessor(frameSize: number) {
  const registered: Record<string, new (options: unknown) => { process: (inputs: Float32Array[][]) => boolean }> = {};
  const posted: Float32Array[] = [];
  class AudioWorkletProcessor {
    port = { postMessage: (data: Float32Array) => posted.push(data) };
  }
  new Function('AudioWorkletProcessor', 'registerProcessor', CAPTURE_WORKLET_SOURCE)(
    AudioWorkletProcessor,
    (name: string, ctor: (typeof registered)[string]) => (registered[name] = ctor),
  );
  const Processor = registered['jarvis-capture']!;
  return { processor: new Processor({ processorOptions: { frameSize } }), posted };
}

describe('capture audio (AudioWorklet)', () => {
  it('regroupe les blocs de 128 échantillons en trames de 4096, sans perte ni désordre', () => {
    const { processor, posted } = loadProcessor(4096);
    let value = 0;
    for (let block = 0; block < 100; block += 1) {
      const quantum = new Float32Array(128).map(() => (value += 1));
      expect(processor.process([[quantum]])).toBe(true);
    }
    expect(posted).toHaveLength(3);
    expect(posted.every((frame) => frame.length === 4096)).toBe(true);
    expect(posted[0]![0]).toBe(1);
    expect(posted[2]![4095]).toBe(3 * 4096);
  });

  it('moyenne tous les canaux : le mixage stéréo ne garde pas seulement la gauche', () => {
    const { processor, posted } = loadProcessor(4);
    const left = new Float32Array([1, 1, 1, 1]);
    const right = new Float32Array([-1, -1, -1, -1]);
    expect(processor.process([[left, right]])).toBe(true);
    expect(Array.from(posted[0]!)).toEqual([0, 0, 0, 0]);
  });

  it('continue sans entrée (micro coupé) sans lever', () => {
    const { processor, posted } = loadProcessor(4096);
    expect(processor.process([[]])).toBe(true);
    expect(processor.process([])).toBe(true);
    expect(posted).toHaveLength(0);
  });
});
