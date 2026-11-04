import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { encodeWav } from '@jarvis/core';
import {
  MIN_PIPER_WAV_BYTES,
  playPiperWavBytes,
  rendererAllowsPiperBlobPlayback,
  wavBlobFromBytes,
} from './piperWavPlayback';

describe('wavBlobFromBytes', () => {
  it('préserve les octets quand la vue IPC est un sous-tableau', async () => {
    const wav = encodeWav(new Float32Array([0, 0.25, -0.25]), 22_050);
    const padded = new Uint8Array(wav.length + 12);
    padded.set(wav, 4);
    const view = padded.subarray(4, 4 + wav.length);
    const fromView = new Uint8Array(await wavBlobFromBytes(view).arrayBuffer());
    expect(fromView).toEqual(wav);
  });
});

describe('renderer CSP Piper', () => {
  it('autorise blob: pour media-src (lecture Écouter)', () => {
    const html = readFileSync(join(import.meta.dirname, '..', '..', 'index.html'), 'utf8');
    const csp = html.match(/content="(default-src[^"]+)"/)?.[1] ?? '';
    expect(rendererAllowsPiperBlobPlayback(csp)).toBe(true);
  });
});

describe('playPiperWavBytes', () => {
  const logs: string[] = [];
  let playCount = 0;

  beforeEach(() => {
    logs.length = 0;
    playCount = 0;
    class MockAudio {
      src = '';
      pause = vi.fn();
      addEventListener(event: string, handler: () => void): void {
        if (event === 'ended') queueMicrotask(handler);
      }
      play = async (): Promise<void> => {
        playCount += 1;
      };
    }
    vi.stubGlobal('Audio', MockAudio);
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:mock-wav',
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('journalise la taille et lit un mini WAV Piper valide', async () => {
    const wav = encodeWav(new Float32Array([0, 0.1]), 22_050);
    expect(wav.byteLength).toBeGreaterThanOrEqual(MIN_PIPER_WAV_BYTES);
    await playPiperWavBytes(wav, 'audio/wav', (line) => logs.push(line));
    expect(logs).toEqual([`[piper] WAV reçu : ${wav.byteLength} octets`]);
    expect(playCount).toBe(1);
  });

  it('refuse un buffer trop court', async () => {
    await expect(playPiperWavBytes(new Uint8Array(10), 'audio/wav', (line) => logs.push(line))).rejects.toThrow(
      /trop court/,
    );
  });
});
