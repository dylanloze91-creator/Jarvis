import { describe, expect, it } from 'vitest';
import { playPiperPartsWithPrefetch } from './piperStream.js';

describe('playPiperPartsWithPrefetch', () => {
  it('lance la synthèse de la phrase suivante pendant la lecture', async () => {
    const order: string[] = [];
    let releaseFirstPlay: (() => void) | null = null;
    const playPromise = playPiperPartsWithPrefetch(
      ['A.', 'B.'],
      async (part) => {
        order.push(`syn:${part}`);
        return { ok: true as const, data: new Uint8Array([1]), mimeType: 'audio/wav' };
      },
      async () => {
        order.push('play:start');
        if (order.filter((entry) => entry === 'play:start').length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstPlay = resolve;
          });
        }
        order.push('play:end');
      },
      () => false,
    );
    await Promise.resolve();
    expect(order).toEqual(['syn:A.', 'play:start', 'syn:B.']);
    releaseFirstPlay?.();
    await playPromise;
    expect(order).toEqual(['syn:A.', 'play:start', 'syn:B.', 'play:end', 'play:start', 'play:end']);
  });
});
