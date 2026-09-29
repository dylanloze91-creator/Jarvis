import { describe, expect, it } from 'vitest';
import {
  OPENWAKEWORD_FRAME_SIZE,
  describeOpenWakeWordLoadError,
  openWakeWordSensitivityToThreshold,
  resampleLinear,
  takeFixedFrames,
} from './openWakeWord.js';

describe('openWakeWord helpers', () => {
  it('abaisse le seuil quand la sensibilité monte', () => {
    expect(openWakeWordSensitivityToThreshold(0)).toBeCloseTo(0.55, 5);
    expect(openWakeWordSensitivityToThreshold(1)).toBeCloseTo(0.25, 5);
    expect(openWakeWordSensitivityToThreshold(0.7)).toBeCloseTo(0.34, 5);
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
