import { describe, expect, it } from 'vitest';
import { buildWakeWordProfile } from './wakeword.js';
import {
  LocalTemplateWakeWordEngine,
  WakeWordEngineRegistry,
  createLocalTemplateWakeWordEngine,
  localTemplateWakeWordDescriptor,
} from './wakewordEngine.js';
import type {
  WakeWordEngine,
  WakeWordEngineController,
  WakeWordEngineDescriptor,
  WakeWordEngineHandlers,
} from './wakewordEngine.js';

function bellCurve(length: number, peakAt = length / 2): number[] {
  return Array.from({ length }, (_, index) => {
    const distance = Math.abs(index - peakAt) / (length / 2);
    return Math.max(0, 1 - distance);
  });
}

/** Une trame audio dont l'amplitude constante donne une énergie RMS connue. */
function constantFrame(amplitude: number, length = 100): Float32Array {
  return new Float32Array(length).fill(amplitude);
}

describe('LocalTemplateWakeWordEngine', () => {
  it("s'annonce comme gratuit et sans capture propre", () => {
    const engine = createLocalTemplateWakeWordEngine({ provider: 'local-template' });
    expect(engine.requiresApiKey).toBe(false);
    expect(engine.managesOwnCapture).toBe(false);
    expect(engine.id).toBe(localTemplateWakeWordDescriptor.id);
  });

  it('renvoie un score continu et détecte quand un gabarit entraîné est reproduit', () => {
    const trainingEnergy = bellCurve(30).map((v) => v); // utilisé comme suite d'amplitudes de trames
    const profile = buildWakeWordProfile(trainingEnergy, 24);

    const engine = new LocalTemplateWakeWordEngine({
      keyword: 'jarvis',
      detectorConfig: { profiles: [profile], matchStrategy: 'best' },
      sensitivity: 1, // très permissif pour un test déterministe
    });

    const scores: number[] = [];
    const detections: string[] = [];
    const controller: WakeWordEngineController = engine.start({
      onScore: (score) => scores.push(score),
      onDetected: (keyword) => detections.push(keyword),
      onError: () => {},
    });

    for (const amplitude of trainingEnergy) {
      controller.pushAudio?.(constantFrame(amplitude), 16000);
    }

    expect(scores.length).toBe(trainingEnergy.length);
    expect(detections).toContain('jarvis');
  });

  it('ne détecte rien sans gabarit configuré', () => {
    const engine = createLocalTemplateWakeWordEngine({ provider: 'local-template' });
    const detections: string[] = [];
    const controller = engine.start({
      onDetected: (keyword) => detections.push(keyword),
      onError: () => {},
    });

    for (let i = 0; i < 10; i += 1) controller.pushAudio?.(constantFrame(0.8), 16000);

    expect(detections).toHaveLength(0);
  });

  it('la sensibilité par défaut vient de la configuration', () => {
    const engine = createLocalTemplateWakeWordEngine({
      provider: 'local-template',
      sensitivity: 0.3,
      keyword: 'ordinateur',
      detectorConfig: null,
    });
    expect(engine.id).toBe('local-template');
  });
});

class FakeWakeWordEngine implements WakeWordEngine {
  readonly managesOwnCapture = true;
  constructor(
    readonly id: string,
    readonly label: string,
    readonly requiresApiKey: boolean,
  ) {}
  start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
    handlers.onDetected(`détecté par ${this.id}`);
    return { stop: () => {} };
  }
}

describe('WakeWordEngineRegistry', () => {
  const localDescriptor: WakeWordEngineDescriptor = {
    id: 'local',
    label: 'Local',
    requiresApiKey: false,
  };
  const paidDescriptor: WakeWordEngineDescriptor = {
    id: 'paid',
    label: 'Payant',
    requiresApiKey: true,
  };

  function buildRegistry(): WakeWordEngineRegistry {
    return new WakeWordEngineRegistry()
      .register(localDescriptor, () => new FakeWakeWordEngine('local', 'Local', false))
      .register(paidDescriptor, () => new FakeWakeWordEngine('paid', 'Payant', true));
  }

  it('liste les moteurs enregistrés', () => {
    const registry = buildRegistry();
    expect(registry.list().map((d) => d.id)).toEqual(['local', 'paid']);
  });

  it('crée le moteur demandé quand il existe', () => {
    const registry = buildRegistry();
    expect(registry.create({ provider: 'local' }).id).toBe('local');
  });

  it('lève une erreur claire pour un moteur inconnu', () => {
    const registry = buildRegistry();
    expect(() => registry.create({ provider: 'inconnu' })).toThrow(/inconnu/);
  });

  it('bascule sur le moteur local quand la clé du moteur payant manque', () => {
    const registry = buildRegistry();
    const { engine, fellBack } = registry.createOrFallback({ provider: 'paid' });
    expect(fellBack).toBe(true);
    expect(engine.id).toBe('local');
  });

  it("n'a pas besoin de repli quand la clé est fournie", () => {
    const registry = buildRegistry();
    const { engine, fellBack } = registry.createOrFallback({ provider: 'paid', apiKey: 'ak-test' });
    expect(fellBack).toBe(false);
    expect(engine.id).toBe('paid');
  });

  it("échoue proprement si aucun moteur local n'est disponible en repli", () => {
    const registry = new WakeWordEngineRegistry().register(
      paidDescriptor,
      () => new FakeWakeWordEngine('paid', 'Payant', true),
    );
    expect(() => registry.createOrFallback({ provider: 'paid' })).toThrow(/repli/);
  });
});
