import { describe, expect, it } from 'vitest';
import { wrapWakeWordEngineWithLoadFallback } from './wakeWordLoadFallback.js';
import type {
  WakeWordEngine,
  WakeWordEngineController,
  WakeWordEngineHandlers,
} from './wakewordEngine.js';

class FakeEngine implements WakeWordEngine {
  readonly managesOwnCapture = false;
  lastHandlers: WakeWordEngineHandlers | null = null;
  frames: Array<{ pcm: Float32Array; sampleRate: number }> = [];

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly failOnPush?: string,
    private readonly mode: 'detect' | 'silent' = 'detect',
  ) {}

  start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
    this.lastHandlers = handlers;
    return {
      pushAudio: (frame, sampleRate) => {
        this.frames.push({ pcm: frame, sampleRate });
        if (this.failOnPush) handlers.onError(this.failOnPush);
        else if (this.mode !== 'silent') handlers.onDetected(this.id);
      },
      stop: () => {},
      getLastAnalyzedWindow: () =>
        this.frames.length > 0
          ? { pcm: this.frames[this.frames.length - 1]!.pcm, sampleRate: 16000 }
          : null,
    };
  }
}

describe('wrapWakeWordEngineWithLoadFallback', () => {
  it('laisse le primaire détecter tant qu’il charge', () => {
    const primary = new FakeEngine('openwakeword', 'OWW');
    const fallback = new FakeEngine('local-template', 'Gabarit');
    const engine = wrapWakeWordEngineWithLoadFallback(primary, () => fallback);
    const detected: string[] = [];
    const errors: string[] = [];
    const controller = engine.start({
      onDetected: (keyword) => detected.push(keyword),
      onError: (message) => errors.push(message),
    });
    controller.pushAudio?.(new Float32Array(8), 16000);
    expect(detected).toEqual(['openwakeword']);
    expect(errors).toEqual([]);
    expect(fallback.frames).toHaveLength(0);
  });

  it('bascule sur le gabarit si le modèle primaire échoue, sans remonter l’erreur', () => {
    const primary = new FakeEngine('openwakeword', 'OWW', 'modèle introuvable');
    const fallback = new FakeEngine('local-template', 'Gabarit');
    const engine = wrapWakeWordEngineWithLoadFallback(primary, () => fallback);
    const detected: string[] = [];
    const errors: string[] = [];
    const controller = engine.start({
      onDetected: (keyword) => detected.push(keyword),
      onError: (message) => errors.push(message),
    });
    controller.pushAudio?.(new Float32Array([0.2]), 16000);
    expect(errors).toEqual([]);
    expect(detected).toEqual(['local-template']);
    expect(fallback.frames).toHaveLength(1);
  });

  it('conserve l’id du moteur primaire (réglages / liste)', () => {
    const engine = wrapWakeWordEngineWithLoadFallback(
      new FakeEngine('openwakeword', 'OWW'),
      () => new FakeEngine('local-template', 'Gabarit'),
    );
    expect(engine.id).toBe('openwakeword');
  });

  it('détecte « Jarvis » via le repli même si hey_jarvis charge et reste muet', () => {
    const primary = new FakeEngine('openwakeword', 'OWW', undefined, 'silent');
    const fallback = new FakeEngine('local-template', 'Gabarit');
    const engine = wrapWakeWordEngineWithLoadFallback(primary, () => fallback, { alwaysOn: true });
    const detected: string[] = [];
    const controller = engine.start({
      onDetected: (keyword) => detected.push(keyword),
      onError: () => {},
    });
    controller.pushAudio?.(new Float32Array([0.3]), 16000);
    expect(primary.frames).toHaveLength(1);
    expect(fallback.frames).toHaveLength(1);
    expect(detected).toEqual(['local-template']);
  });

  it('n’affiche pas « indisponible » du primaire si le repli alwaysOn tourne déjà', () => {
    const primary = new FakeEngine('openwakeword', 'OWW', 'ERROR_CODE: 6');
    const fallback = new FakeEngine('local-template', 'Gabarit');
    const engine = wrapWakeWordEngineWithLoadFallback(primary, () => fallback, { alwaysOn: true });
    const detected: string[] = [];
    const errors: string[] = [];
    const controller = engine.start({
      onDetected: (keyword) => detected.push(keyword),
      onError: (message) => errors.push(message),
    });
    controller.pushAudio?.(new Float32Array([0.4]), 16000);
    expect(errors).toEqual([]);
    expect(detected).toEqual(['local-template']);
  });

  it('ne mélange pas les scores du repli à ceux d’openWakeWord tant que celui-ci fonctionne', () => {
    const scored: WakeWordEngine = {
      id: 'openwakeword',
      label: 'OWW',
      managesOwnCapture: false,
      start: (handlers) => ({ pushAudio: () => handlers.onScore?.(0.2), stop: () => {} }),
    };
    const noisy: WakeWordEngine = {
      id: 'local-template',
      label: 'Gabarit',
      managesOwnCapture: false,
      start: (handlers) => ({ pushAudio: () => handlers.onScore?.(1), stop: () => {} }),
    };
    const engine = wrapWakeWordEngineWithLoadFallback(scored, () => noisy, { alwaysOn: true });
    const scores: number[] = [];
    const controller = engine.start({ onDetected: () => {}, onError: () => {}, onScore: (s) => scores.push(s) });
    controller.pushAudio?.(new Float32Array([0.1]), 16000);
    expect(scores).toEqual([0.2]);
  });
});
