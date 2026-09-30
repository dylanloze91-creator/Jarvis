import { describe, expect, it } from 'vitest';
import {
  OPENWAKEWORD_FRAME_SIZE,
  OPENWAKEWORD_MEL_BINS,
  OPENWAKEWORD_MEL_CONTEXT,
  OPENWAKEWORD_MEL_WINDOW,
  OpenWakeWordMelStream,
  describeOpenWakeWordLoadError,
  openWakeWordSensitivityToThreshold,
  resampleLinear,
  takeFixedFrames,
} from './openWakeWord.js';

describe('openWakeWord helpers', () => {
  it('abaisse le seuil quand la sensibilité monte', () => {
    expect(openWakeWordSensitivityToThreshold(0)).toBeCloseTo(0.85, 5);
    expect(openWakeWordSensitivityToThreshold(1)).toBeCloseTo(0.35, 5);
    expect(openWakeWordSensitivityToThreshold(0.7)).toBeCloseTo(0.5, 5);
    expect(openWakeWordSensitivityToThreshold(0.7)).toBeLessThan(
      openWakeWordSensitivityToThreshold(0.3),
    );
  });

  it('découpe un flux en trames de 1280 échantillons en conservant le reste', () => {
    const first = takeFixedFrames(new Float32Array(0), new Float32Array(2000), OPENWAKEWORD_FRAME_SIZE);
    expect(first.chunks).toHaveLength(1);
    expect(first.chunks[0]).toHaveLength(1280);
    expect(first.remainder).toHaveLength(720);
    const second = takeFixedFrames(first.remainder, new Float32Array(600), OPENWAKEWORD_FRAME_SIZE);
    expect(second.chunks).toHaveLength(1);
    expect(second.remainder).toHaveLength(40);
  });

  it('laisse intact un PCM déjà à 16 kHz', () => {
    const pcm = new Float32Array([0, 0.5, 1]);
    expect(resampleLinear(pcm, 16000, 16000)).toBe(pcm);
  });

  it('rééchantillonne un signal 8 kHz vers 16 kHz', () => {
    const pcm = new Float32Array([0, 1]);
    const up = resampleLinear(pcm, 8000, 16000);
    expect(up.length).toBe(4);
    expect(up[0]).toBeCloseTo(0, 5);
    expect(up[up.length - 1]).toBeCloseTo(1, 5);
  });

  it('redonne au mel les 480 échantillons précédents, comme AudioFeatures', () => {
    const stream = new OpenWakeWordMelStream();
    const first = new Float32Array(1280).fill(1);
    const second = new Float32Array(1280).fill(2);
    const third = new Float32Array(1280).fill(3);

    expect(stream.melInput(first)).toHaveLength(1280);
    const secondInput = stream.melInput(second);
    expect(secondInput).toHaveLength(1280 + OPENWAKEWORD_MEL_CONTEXT);
    expect(secondInput[0]).toBe(1);
    expect(secondInput[OPENWAKEWORD_MEL_CONTEXT - 1]).toBe(1);
    expect(secondInput[OPENWAKEWORD_MEL_CONTEXT]).toBe(2);
    const thirdInput = stream.melInput(third);
    expect(thirdInput).toHaveLength(1760);
    expect(thirdInput[0]).toBe(2);
    expect(thirdInput[480]).toBe(3);
  });

  it('empile 8 trames mel par pas et garde les 76 dernières pour l’embedding', () => {
    const stream = new OpenWakeWordMelStream();
    const initial = stream.embeddingWindow();
    expect(initial).toHaveLength(OPENWAKEWORD_MEL_WINDOW * OPENWAKEWORD_MEL_BINS);
    expect(Array.from(initial).every((value) => value === 1)).toBe(true);

    const raw = new Float32Array(8 * OPENWAKEWORD_MEL_BINS).fill(10);
    expect(stream.pushMel(raw)).toBe(8);
    const window = stream.embeddingWindow();
    // x / 10 + 2 = 3 pour les 8 nouvelles trames, en fin de fenêtre.
    expect(window[window.length - 1]).toBe(3);
    expect(window[(OPENWAKEWORD_MEL_WINDOW - 8) * OPENWAKEWORD_MEL_BINS]).toBe(3);
    expect(window[(OPENWAKEWORD_MEL_WINDOW - 9) * OPENWAKEWORD_MEL_BINS]).toBe(1);

    stream.reset();
    expect(Array.from(stream.embeddingWindow()).every((value) => value === 1)).toBe(true);
  });

  it('résume ERROR_CODE onnxruntime (les chiffres à côté de « indisponible »)', () => {
    expect(
      describeOpenWakeWordLoadError(
        new Error("Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: Load model from file://... failed"),
      ),
    ).toBe('code 6');
    expect(describeOpenWakeWordLoadError(new Error('Failed to fetch'))).toBe(
      'fichiers du modèle introuvables',
    );
  });
});
