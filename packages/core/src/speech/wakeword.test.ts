import { describe, expect, it } from 'vitest';
import {
  WakeWordDetector,
  buildWakeWordProfile,
  cosineSimilarity,
  normalize,
  resample,
} from './wakeword.js';

/** Simule une trame d'énergie en forme de cloche, pour représenter un mot prononcé. */
function bellCurve(length: number, peakAt = length / 2): number[] {
  return Array.from({ length }, (_, index) => {
    const distance = Math.abs(index - peakAt) / (length / 2);
    return Math.max(0, 1 - distance);
  });
}

function silence(length: number): number[] {
  return new Array(length).fill(0.01);
}

describe('resample', () => {
  it('conserve la longueur cible', () => {
    expect(resample([0, 1, 2, 3], 2)).toHaveLength(2);
    expect(resample([1], 5)).toHaveLength(5);
  });

  it('interpole linéairement', () => {
    expect(resample([0, 10], 3)).toEqual([0, 5, 10]);
  });
});

describe('normalize', () => {
  it('ramène le maximum à 1', () => {
    expect(normalize([0, 2, 4])).toEqual([0, 0.5, 1]);
  });

  it("ne divise pas par zéro sur un tableau vide d'énergie", () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('cosineSimilarity', () => {
  it('vaut 1 pour deux vecteurs identiques', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('vaut 0 pour un vecteur nul', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('buildWakeWordProfile', () => {
  it('produit un gabarit normalisé de la longueur demandée', () => {
    const profile = buildWakeWordProfile(bellCurve(40), 24);
    expect(profile.envelope).toHaveLength(24);
    expect(Math.max(...profile.envelope)).toBeCloseTo(1, 5);
  });
});

describe('WakeWordDetector', () => {
  it("ne détecte rien tant qu'aucun gabarit n'est configuré", () => {
    const detector = new WakeWordDetector(null, { frameMs: 30, windowMs: 300 });
    let detected = false;
    for (let i = 0; i < 20; i += 1) {
      detected = detector.pushEnergy(0.8, i * 30) || detected;
    }
    expect(detected).toBe(false);
  });

  it('détecte une trame qui reproduit fidèlement le gabarit entraîné', () => {
    const trainingEnergy = bellCurve(30);
    const profile = buildWakeWordProfile(trainingEnergy, 24);
    const detector = new WakeWordDetector(profile, {
      frameMs: 30,
      windowMs: 30 * 30,
      threshold: 0.9,
      cooldownMs: 1000,
    });

    let detected = false;
    let now = 0;
    for (const energy of trainingEnergy) {
      now += 30;
      detected = detector.pushEnergy(energy, now) || detected;
    }
    expect(detected).toBe(true);
  });

  it('ne se déclenche pas sur du silence', () => {
    const trainingEnergy = bellCurve(30);
    const profile = buildWakeWordProfile(trainingEnergy, 24);
    const detector = new WakeWordDetector(profile, {
      frameMs: 30,
      windowMs: 30 * 30,
      threshold: 0.9,
      cooldownMs: 1000,
    });

    let detected = false;
    let now = 0;
    for (const energy of silence(60)) {
      now += 30;
      detected = detector.pushEnergy(energy, now) || detected;
    }
    expect(detected).toBe(false);
  });

  it('respecte le délai de repos entre deux détections', () => {
    const trainingEnergy = bellCurve(30);
    const profile = buildWakeWordProfile(trainingEnergy, 24);
    const detector = new WakeWordDetector(profile, {
      frameMs: 30,
      windowMs: 30 * 30,
      threshold: 0.9,
      cooldownMs: 5000,
    });

    let now = 0;
    let detections = 0;
    for (let repetition = 0; repetition < 2; repetition += 1) {
      for (const energy of trainingEnergy) {
        now += 30;
        if (detector.pushEnergy(energy, now)) detections += 1;
      }
    }
    expect(detections).toBe(1);
  });

  it('setProfile met à jour le gabarit utilisé et réinitialise la mémoire tampon', () => {
    const detector = new WakeWordDetector(null);
    expect(detector.hasProfile()).toBe(false);
    detector.setProfile(buildWakeWordProfile(bellCurve(30)));
    expect(detector.hasProfile()).toBe(true);
  });
});
