import { describe, expect, it, vi } from 'vitest';
import { encodeWav } from '@jarvis/core';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/jarvis-piper-test',
  },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, access: vi.fn(async () => undefined) };
});

import { FakePiperRunner } from './runner.js';
import { PiperService } from './service.js';

describe('PiperService', () => {
  it('fusionne plusieurs phrases quand le mode streaming est actif', async () => {
    const clip = encodeWav(new Float32Array([0, 0.1, -0.1]), 22_050);
    const service = new PiperService(new FakePiperRunner(clip));
    const long = 'Bonjour Jarvis. Voici une première phrase assez longue pour activer le mode phrase. Et voici une deuxième phrase.';
    const wav = await service.synthesizeWav({ text: long });
    expect(wav.length).toBeGreaterThan(clip.length);
  });

  it('refuse un texte vide', async () => {
    const service = new PiperService(new FakePiperRunner(encodeWav(new Float32Array([0]), 22_050)));
    await expect(service.synthesizeWav({ text: '   ' })).rejects.toThrow(/vide/);
  });
});
