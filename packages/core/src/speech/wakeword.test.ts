import { describe, expect, it } from 'vitest';
import {
  WakeWordDetector,
  buildWakeWordEnvelope,
  buildWakeWordProfile,
  cosineSimilarity,
  normalize,
  resample,
  thresholdForSensitivity,
} from './wakeword.js';

/** Simule une trame d'énergie en forme de cloche, pour représenter un mot prononcé. */
function bellCurve(length: number, peakAt = length / 2): number[] {
  return Array.from({ length }, (_, index) => {
    const distance = Math.abs(index - peakAt) / (length / 2);
    return Math.max(0, 1 - distance);
  });
}

function silence(length: number): number[] {
  return new Array(length).fill(0.004);
}

/** Fait défiler une séquence d'énergies et renvoie le nombre de détections. */
function feed(detector: WakeWordDetector, energies: number[], startAt = 0): number {
  let now = startAt;
  let detections = 0;
  for (const energy of energies) {
    now += 30;
    if (detector.pushEnergy(energy, now).detected) detections += 1;
  }
  return detections;
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

describe('thresholdForSensitivity', () => {
  it('exige une correspondance plus forte quand la sensibilité baisse', () => {
    expect(thresholdForSensitivity(0)).toBeGreaterThan(thresholdForSensitivity(1));
  });

  it('borne les valeurs hors intervalle', () => {
    expect(thresholdForSensitivity(-5)).toBe(thresholdForSensitivity(0));
    expect(thresholdForSensitivity(5)).toBe(thresholdForSensitivity(1));
  });
});

describe('buildWakeWordProfile', () => {
  it('produit un gabarit normalisé par échantillon', () => {
    const profile = buildWakeWordProfile([bellCurve(40), bellCurve(30)]);
    expect(profile.envelopes).toHaveLength(2);
    for (const envelope of profile.envelopes) {
      expect(envelope).toHaveLength(24);
      expect(Math.max(...envelope)).toBeCloseTo(1, 5);
    }
  });

  it('ignore les échantillons vides', () => {
    expect(buildWakeWordProfile([[], bellCurve(30)]).envelopes).toHaveLength(1);
  });
});

describe('WakeWordDetector', () => {
  const options = { frameMs: 30, windowMs: 900, sensitivity: 0.2, cooldownMs: 1000 };

  it("ne détecte rien tant qu'aucun gabarit n'est configuré", () => {
    const detector = new WakeWordDetector(null, options);
    expect(feed(detector, new Array(40).fill(0.8))).toBe(0);
  });

  it('détecte une prononciation qui reproduit le gabarit entraîné', () => {
    const training = bellCurve(30);
    const detector = new WakeWordDetector(buildWakeWordProfile([training]), options);
    expect(feed(detector, training)).toBe(1);
  });

  it('ne se déclenche pas sur du silence, dont l’enveloppe est plate', () => {
    const detector = new WakeWordDetector(buildWakeWordProfile([bellCurve(30)]), options);
    expect(feed(detector, silence(60))).toBe(0);
  });

  it('reconnaît une prononciation que seul le second échantillon couvre', () => {
    const late = bellCurve(30, 24);
    const single = new WakeWordDetector(buildWakeWordProfile([bellCurve(30, 6)]), options);
    const multiple = new WakeWordDetector(
      buildWakeWordProfile([bellCurve(30, 6), bellCurve(30, 24)]),
      options,
    );

    expect(feed(single, late)).toBe(0);
    expect(feed(multiple, late)).toBe(1);
  });

  it('remonte un score exploitable par l’indicateur de calibration', () => {
    const training = bellCurve(30);
    const detector = new WakeWordDetector(buildWakeWordProfile([training]), options);

    let best = 0;
    let now = 0;
    for (const energy of training) {
      now += 30;
      best = Math.max(best, detector.pushEnergy(energy, now).score);
    }
    expect(best).toBeGreaterThan(0.9);
  });

  it('respecte le délai de repos entre deux détections', () => {
    const training = bellCurve(30);
    const detector = new WakeWordDetector(buildWakeWordProfile([training]), {
      ...options,
      cooldownMs: 5000,
    });
    expect(feed(detector, [...training, ...training])).toBe(1);
  });

  it('une sensibilité plus basse rejette une prononciation approximative', () => {
    const approximate = bellCurve(30, 18);
    const permissive = new WakeWordDetector(buildWakeWordProfile([bellCurve(30, 10)]), {
      ...options,
      sensitivity: 1,
    });
    const strict = new WakeWordDetector(buildWakeWordProfile([bellCurve(30, 10)]), {
      ...options,
      sensitivity: 0,
    });

    expect(feed(permissive, approximate)).toBe(1);
    expect(feed(strict, approximate)).toBe(0);
  });

  it('setProfile met à jour les gabarits utilisés', () => {
    const detector = new WakeWordDetector(null);
    expect(detector.hasProfile()).toBe(false);
    detector.setProfile(buildWakeWordProfile([bellCurve(30)]));
    expect(detector.hasProfile()).toBe(true);
    detector.setProfile({ envelopes: [] });
    expect(detector.hasProfile()).toBe(false);
  });

  it('buildWakeWordEnvelope produit une enveloppe de longueur fixe', () => {
    expect(buildWakeWordEnvelope(bellCurve(100))).toHaveLength(24);
  });
});
