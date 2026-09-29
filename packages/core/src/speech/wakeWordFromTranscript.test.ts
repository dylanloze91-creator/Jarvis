import { describe, expect, it, vi } from 'vitest';
import { evaluateWakeWordWindow, peakEnergy, speechDurationMs } from './wakeWordFromTranscript.js';

function silentFrame(length = 512): Float32Array {
  return new Float32Array(length).fill(0.001);
}

function speechLikeFrame(length = 512): Float32Array {
  const frame = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    frame[index] = Math.sin(index / 5) * 0.4;
  }
  return frame;
}

describe('speechDurationMs', () => {
  const tone = (ms: number, amplitude: number) =>
    new Float32Array(Math.round(16 * ms)).map((_, i) => Math.sin(i / 5) * amplitude);

  it('mesure la parole par fenêtres de 64 ms, pas un pic isolé', () => {
    expect(speechDurationMs(new Float32Array(16000), 16000)).toBe(0);
    expect(speechDurationMs(tone(1000, 0.2), 16000)).toBeCloseTo(960, -1);
    const click = new Float32Array(16000);
    click[100] = 1;
    expect(speechDurationMs(click, 16000)).toBeLessThanOrEqual(64);
  });

  it('la fin d’un « Jarvis » (≤ 256 ms) reste sous le seuil d’une commande (300 ms)', () => {
    expect(speechDurationMs(tone(256, 0.1), 16000)).toBeLessThan(300);
    expect(speechDurationMs(tone(600, 0.1), 16000)).toBeGreaterThan(300);
  });
});

describe('peakEnergy', () => {
  it('vaut 0 pour un silence numérique parfait', () => {
    expect(peakEnergy(new Float32Array([0, 0, 0]))).toBe(0);
  });

  it("vaut l'amplitude absolue maximale, y compris pour un pic négatif", () => {
    expect(peakEnergy(new Float32Array([0.1, -0.9, 0.3]))).toBeCloseTo(0.9, 5);
  });
});

describe('evaluateWakeWordWindow', () => {
  it("ne transcrit pas une fenêtre trop calme (garde d'énergie) — coût CPU nul", async () => {
    const transcribe = vi.fn().mockResolvedValue('jarvis');
    const result = await evaluateWakeWordWindow(silentFrame(), 16000, transcribe, {
      word: 'jarvis',
    });

    expect(transcribe).not.toHaveBeenCalled();
    expect(result).toEqual({ analyzed: false, transcript: null, matched: false });
  });

  it('transcrit une fenêtre avec assez de parole, puis détecte le mot de réveil', async () => {
    const transcribe = vi.fn().mockResolvedValue('Bonjour Jarvis');
    const result = await evaluateWakeWordWindow(speechLikeFrame(), 16000, transcribe, {
      word: 'jarvis',
    });

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledWith(expect.any(Float32Array), 16000);
    expect(result).toEqual({ analyzed: true, transcript: 'Bonjour Jarvis', matched: true });
  });

  it('transcrit mais ne détecte rien si le texte ne contient pas le mot de réveil', async () => {
    const transcribe = vi.fn().mockResolvedValue('Il fait beau');
    const result = await evaluateWakeWordWindow(speechLikeFrame(), 16000, transcribe, {
      word: 'jarvis',
    });

    expect(result).toEqual({ analyzed: true, transcript: 'Il fait beau', matched: false });
  });

  it('respecte un seuil de garde personnalisé', async () => {
    const transcribe = vi.fn().mockResolvedValue('jarvis');
    const quietFrame = new Float32Array(256).fill(0.05);

    const strict = await evaluateWakeWordWindow(
      quietFrame,
      16000,
      transcribe,
      { word: 'jarvis' },
      { minPeakEnergy: 0.2 },
    );
    expect(strict.analyzed).toBe(false);

    const loose = await evaluateWakeWordWindow(
      quietFrame,
      16000,
      transcribe,
      { word: 'jarvis' },
      { minPeakEnergy: 0.01 },
    );
    expect(loose.analyzed).toBe(true);
  });
});
