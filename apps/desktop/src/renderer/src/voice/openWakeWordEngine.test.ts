import { ATTENUATED_PEAK } from '@jarvis/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./onnxRuntime', () => ({ configureOnnxRuntime: vi.fn(), withOrtLock: <T>(task: () => Promise<T>) => task() }));
const { OpenWakeWordEngine } = await import('./openWakeWordEngine');

class FakeTensor {
  constructor(
    readonly type: string,
    readonly data: ArrayLike<number>,
    readonly dims?: number[],
  ) {}
}

function fakeSession(run: () => Record<string, { data: Float32Array }>) {
  return {
    inputNames: ['input'],
    outputNames: ['output'],
    inputMetadata: [{ shape: [1, 16, 96] }],
    run: async () => run(),
  };
}

function fakeModels(keywordScore: number) {
  return {
    ort: { Tensor: FakeTensor },
    mel: fakeSession(() => ({ output: { data: new Float32Array(160).fill(1) } })),
    embedding: fakeSession(() => ({ output: { data: new Float32Array(96).fill(0.1) } })),
    keyword: fakeSession(() => ({ output: { data: new Float32Array([keywordScore]) } })),
  } as never;
}

describe('OpenWakeWordEngine', () => {
  it('est local, sans capture propre', () => {
    const engine = new OpenWakeWordEngine({}, async () => {
      throw new Error('ne devrait pas charger');
    });
    expect(engine.id).toBe('openwakeword');
    expect(engine.managesOwnCapture).toBe(false);
  });

  it('signale une erreur (une seule fois) si les modèles ONNX refusent de charger', async () => {
    const engine = new OpenWakeWordEngine({}, async () => {
      throw new Error('HTTP 404 pour jarvis-oww://openwakeword/hey_jarvis_v0.1.onnx');
    });
    const errors: string[] = [];
    const controller = engine.start({ onDetected: () => {}, onError: (message) => errors.push(message) });
    for (let i = 0; i < 5; i += 1) controller.pushAudio?.(new Float32Array(1280), 16000);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBe('openWakeWord indisponible : fichiers du modèle introuvables');
    controller.stop();
  });

  it('ne reste pas muet indéfiniment si le runtime ne répond jamais (bug ORT 1.22 + blob)', async () => {
    vi.useFakeTimers();
    try {
      const engine = new OpenWakeWordEngine({}, () => new Promise(() => undefined), 30_000);
      const errors: string[] = [];
      const controller = engine.start({ onDetected: () => {}, onError: (message) => errors.push(message) });
      controller.pushAudio?.(new Float32Array(1280), 16000);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(errors).toEqual(['openWakeWord indisponible : chargement bloqué plus de 30 s']);
      controller.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('détecte quand le classifieur dépasse le seuil, et remonte le score', async () => {
    const engine = new OpenWakeWordEngine({ keyword: 'jarvis' }, async () => fakeModels(0.92));
    const detected: string[] = [];
    const scores: number[] = [];
    const controller = engine.start({
      onDetected: (keyword) => detected.push(keyword),
      onScore: (score) => scores.push(score),
      onError: () => {},
    });
    for (let i = 0; i < 20; i += 1) controller.pushAudio?.(new Float32Array(1280).fill(0.02), 16000);
    await vi.waitFor(() => expect(detected).toContain('jarvis'));
    expect(Math.max(...scores)).toBeCloseTo(0.92, 5);
    expect(controller.getLastAnalyzedWindow?.()?.sampleRate).toBe(16000);
    controller.stop();
  });

  it('reçoit du 16 kHz mono (trames de 1280) et atténue une crête ≥ 1 avant l’échelle 16 bits', async () => {
    const seen: Float32Array[] = [];
    const engine = new OpenWakeWordEngine({ keyword: 'jarvis', sensitivity: 1 }, async () => ({
      ort: { Tensor: FakeTensor },
      mel: {
        inputNames: ['input'],
        outputNames: ['output'],
        inputMetadata: [{ shape: [1, 16, 96] }],
        run: async (feeds: { input: { data: Float32Array } }) => {
          seen.push(feeds.input.data);
          return { output: { data: new Float32Array(160).fill(0) } };
        },
      },
      embedding: fakeSession(() => ({ output: { data: new Float32Array(96).fill(0) } })),
      keyword: fakeSession(() => ({ output: { data: new Float32Array([0]) } })),
    }) as never);
    const controller = engine.start({ onDetected: () => {}, onError: () => {} });
    const clipped = new Float32Array(7680);
    clipped.fill(1.2);
    controller.pushAudio?.(clipped, 48000);
    await controller.idle();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toHaveLength(1280);
    expect(seen[0]![0]).toBeCloseTo(ATTENUATED_PEAK * 32767, 0);
    expect(Math.max(...seen[0]!)).toBeLessThan(32767);
    controller.stop();
  });

  it('reste silencieux sous le seuil', async () => {
    const engine = new OpenWakeWordEngine({ keyword: 'jarvis', sensitivity: 0.7 }, async () => fakeModels(0.1));
    const detected: string[] = [];
    const scores: number[] = [];
    const controller = engine.start({
      onDetected: (keyword) => detected.push(keyword),
      onScore: (score) => scores.push(score),
      onError: () => {},
    });
    for (let i = 0; i < 20; i += 1) controller.pushAudio?.(new Float32Array(1280).fill(0.02), 16000);
    await vi.waitFor(() => expect(scores.length).toBeGreaterThan(0));
    expect(detected).toEqual([]);
    controller.stop();
  });
});
