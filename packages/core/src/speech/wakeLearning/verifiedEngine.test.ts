import { describe, expect, it, vi } from 'vitest';
import type { WakeWordEngine, WakeWordEngineHandlers, WakeWordWindow } from '../wakewordEngine.js';
import { WAKE_FEATURE_SIZE } from './features.js';
import { wrapWakeWordEngineWithVerifier } from './verifiedEngine.js';
import type { WakeVerifierModel } from './verifier.js';

function fakeEngine() {
  let handlers: WakeWordEngineHandlers | null = null;
  const window: WakeWordWindow = { pcm: new Float32Array(16000), sampleRate: 16000, commandOffset: 8000 };
  const engine: WakeWordEngine = {
    id: 'fake',
    label: 'fake',
    managesOwnCapture: false,
    start: (h) => {
      handlers = h;
      return { stop: () => undefined, pushAudio: () => undefined, getLastAnalyzedWindow: () => window };
    },
  };
  return { engine, window, handlers: () => handlers! };
}

const model = (overrides: Partial<WakeVerifierModel> = {}): WakeVerifierModel => ({
  version: 1,
  featureSize: WAKE_FEATURE_SIZE,
  mean: new Array(WAKE_FEATURE_SIZE).fill(0),
  scale: new Array(WAKE_FEATURE_SIZE).fill(1),
  weights: [10, ...new Array(WAKE_FEATURE_SIZE - 1).fill(0)],
  bias: 0,
  vetoThreshold: 0.3,
  rescueThreshold: 0.9,
  vetoEnabled: true,
  trainedAt: 0,
  positives: 20,
  negatives: 20,
  cvRecall: 1,
  cvRejection: 1,
  ...overrides,
});

const features = (first: number): number[] => [first, ...new Array(WAKE_FEATURE_SIZE - 1).fill(0)];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('couche personnelle sur les détecteurs', () => {
  it('sans modèle : le réveil passe tout de suite, sans attendre les caractéristiques', () => {
    const { engine, handlers } = fakeEngine();
    const onDetected = vi.fn();
    const featureSpy = vi.fn(async () => features(1));
    const wrapped = wrapWakeWordEngineWithVerifier(engine, { getModel: () => null, features: featureSpy });
    wrapped.start({ onDetected, onError: () => undefined });
    handlers().onDetected('jarvis');
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(featureSpy).not.toHaveBeenCalled();
  });

  it('sans modèle : un quasi-réveil n’est jamais accepté', async () => {
    const { engine, handlers, window } = fakeEngine();
    const onDetected = vi.fn();
    const wrapped = wrapWakeWordEngineWithVerifier(engine, { getModel: () => null, features: async () => features(5) });
    wrapped.start({ onDetected, onError: () => undefined });
    handlers().onNearMiss?.('jarvis', window);
    await flush();
    expect(onDetected).not.toHaveBeenCalled();
  });

  it('avec modèle : veto d’un réveil peu probable, acceptation d’un réveil probable', async () => {
    const { engine, handlers } = fakeEngine();
    const onDetected = vi.fn();
    const reports: string[] = [];
    let next = -1;
    const wrapped = wrapWakeWordEngineWithVerifier(engine, {
      getModel: () => model(),
      features: async () => features(next),
      onCandidate: (report) => reports.push(report.decision.reason),
    });
    wrapped.start({ onDetected, onError: () => undefined });
    handlers().onDetected('jarvis');
    await flush();
    expect(onDetected).not.toHaveBeenCalled();
    next = 1;
    handlers().onDetected('jarvis');
    await flush();
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(reports).toEqual(['vetoed', 'verified']);
  });

  it('rattrapage d’un quasi-réveil sûr ; l’audio arrivé pendant la vérification est gardé', async () => {
    const { engine, handlers, window } = fakeEngine();
    const onDetected = vi.fn();
    let release: (value: number[]) => void = () => undefined;
    const wrapped = wrapWakeWordEngineWithVerifier(engine, {
      getModel: () => model(),
      features: () => new Promise<number[]>((resolve) => (release = resolve)),
    });
    const controller = wrapped.start({ onDetected, onError: () => undefined });
    handlers().onNearMiss?.('jarvis', window);
    controller.pushAudio?.(new Float32Array(1600), 16000);
    release(features(1));
    await flush();
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(controller.getLastAnalyzedWindow?.()?.pcm.length).toBe(16000 + 1600);
  });

  it('caractéristiques indisponibles : réveil accepté comme en 0.4.16', async () => {
    const { engine, handlers } = fakeEngine();
    const onDetected = vi.fn();
    const wrapped = wrapWakeWordEngineWithVerifier(engine, { getModel: () => model(), features: async () => null });
    wrapped.start({ onDetected, onError: () => undefined });
    handlers().onDetected('jarvis');
    await flush();
    expect(onDetected).toHaveBeenCalledTimes(1);
  });
});
