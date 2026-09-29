import { describe, expect, it } from 'vitest';
import { buildWakeWordProfile } from './wakeword.js';
import { LocalTemplateWakeWordEngine, createLocalTemplateWakeWordEngine } from './wakewordEngine.js';
import type { WakeWordEngineController } from './wakewordEngine.js';

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
    const engine = createLocalTemplateWakeWordEngine({});
    expect(engine.managesOwnCapture).toBe(false);
    expect(engine.id).toBe('local-template');
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

  it('émet un candidat sur une rafale d’énergie même sans gabarit', () => {
    const engine = createLocalTemplateWakeWordEngine({ sensitivity: 1 });
    const detections: string[] = [];
    const controller = engine.start({
      onDetected: (keyword) => detections.push(keyword),
      onError: () => {},
    });

    for (let i = 0; i < 16; i += 1) controller.pushAudio?.(constantFrame(0.8, 1024), 16000);

    expect(detections).toContain('jarvis');
  });

  it('sans gabarit, une rafale de 0,1 s (clic, toux) ne suffit pas', () => {
    const engine = createLocalTemplateWakeWordEngine({ sensitivity: 1 });
    const detections: string[] = [];
    const controller = engine.start({ onDetected: (k) => detections.push(k), onError: () => {} });
    for (let i = 0; i < 16; i += 1) controller.pushAudio?.(constantFrame(0.8), 16000);
    expect(detections).toEqual([]);
  });

  it('sans gabarit, un « Jarvis » d’environ 0,5 s suffit avec les trames de 256 ms du micro', () => {
    const engine = createLocalTemplateWakeWordEngine({ sensitivity: 0.7 });
    const detections: string[] = [];
    const controller = engine.start({ onDetected: (k) => detections.push(k), onError: () => {} });
    for (let i = 0; i < 4; i += 1) controller.pushAudio?.(constantFrame(0, 4096), 16000);
    controller.pushAudio?.(constantFrame(0.2, 4096), 16000);
    expect(detections).toEqual([]);
    controller.pushAudio?.(constantFrame(0.2, 4096), 16000);
    controller.pushAudio?.(constantFrame(0.005, 4096), 16000);
    expect(detections).toEqual(['jarvis']);
    const window = controller.getLastAnalyzedWindow?.();
    expect(window?.pcm.length).toBeGreaterThanOrEqual(3 * 4096);
    expect(window?.pcm.at(-1)).toBeCloseTo(0.005, 5);
  });

  it('un « Jarvis ? » traînant (1 s) entre en entier dans la fenêtre du candidat', () => {
    const engine = createLocalTemplateWakeWordEngine({ sensitivity: 0.7 });
    const detections: number[] = [];
    let frame = 0;
    const controller = engine.start({ onDetected: () => detections.push(frame), onError: () => {} });
    for (const amplitude of [0, 0, 0.2, 0.2, 0.2, 0.15, 0.001, 0]) {
      frame += 1;
      controller.pushAudio?.(constantFrame(amplitude, 4096), 16000);
    }
    expect(detections).toEqual([6]);
    const window = controller.getLastAnalyzedWindow?.()?.pcm;
    expect(window?.length).toBe(6 * 4096);
    expect(window?.[2 * 4096]).toBeCloseTo(0.2, 5);
    expect(window?.at(-1)).toBeCloseTo(0.15, 5);
  });

  it('« Jarvis, quelle heure est-il » enchaîné : candidat au bout d’une seconde de parole', () => {
    const engine = createLocalTemplateWakeWordEngine({ sensitivity: 0.7 });
    const detections: number[] = [];
    let frame = 0;
    const controller = engine.start({ onDetected: () => detections.push(frame), onError: () => {} });
    for (let i = 0; i < 8; i += 1) {
      frame += 1;
      controller.pushAudio?.(constantFrame(0.2, 4096), 16000);
    }
    expect(detections).toEqual([4]);
  });

  it('avec des gabarits qui ne ressemblent pas, la rafale propose quand même un candidat', () => {
    const profile = buildWakeWordProfile(bellCurve(30), 24);
    const engine = new LocalTemplateWakeWordEngine({
      keyword: 'jarvis',
      detectorConfig: { profiles: [profile], matchStrategy: 'best' },
      sensitivity: 0.7,
    });
    const detections: string[] = [];
    const controller = engine.start({ onDetected: (k) => detections.push(k), onError: () => {} });
    for (const amplitude of [0, 0.2, 0.2, 0.001, 0]) controller.pushAudio?.(constantFrame(amplitude, 4096), 16000);
    expect(detections).toEqual(['jarvis']);
  });

  it('compte le délai entre deux candidats en temps audio (fichier analysé d’un bloc)', () => {
    const engine = createLocalTemplateWakeWordEngine({ sensitivity: 0.7 });
    const detections: number[] = [];
    let frame = 0;
    const controller = engine.start({ onDetected: () => detections.push(frame), onError: () => {} });
    const pattern = [0.2, 0.2, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.2, 0];
    for (const amplitude of pattern) {
      frame += 1;
      controller.pushAudio?.(constantFrame(amplitude, 4096), 16000);
    }
    expect(detections).toEqual([3, 12]);
    expect(controller.getLastAnalyzedWindow?.()?.pcm.length).toBeGreaterThan(0);
  });

  it('conserve la fenêtre PCM qui a déclenché un gabarit', () => {
    const trainingEnergy = bellCurve(30);
    const profile = buildWakeWordProfile(trainingEnergy, 24);
    const engine = new LocalTemplateWakeWordEngine({
      keyword: 'jarvis',
      detectorConfig: { profiles: [profile], matchStrategy: 'best' },
      sensitivity: 1,
    });
    const controller = engine.start({
      onDetected: () => {},
      onError: () => {},
    });
    for (const amplitude of trainingEnergy) {
      controller.pushAudio?.(constantFrame(amplitude), 16000);
    }
    expect(controller.getLastAnalyzedWindow?.()?.sampleRate).toBe(16000);
  });

  it('la sensibilité par défaut vient de la configuration', () => {
    const engine = createLocalTemplateWakeWordEngine({
      sensitivity: 0.3,
      keyword: 'ordinateur',
      detectorConfig: null,
    });
    expect(engine.id).toBe('local-template');
  });
});
