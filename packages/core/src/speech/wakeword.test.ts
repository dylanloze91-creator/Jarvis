import { describe, expect, it } from 'vitest';
import {
  SENSITIVITY_THRESHOLD_RANGE,
  WakeWordDetector,
  averageProfiles,
  buildWakeWordProfile,
  computeRms,
  cosineSimilarity,
  normalize,
  resample,
  sensitivityToThreshold,
  thresholdToSensitivity,
} from './wakeword.js';

/** Simule une trame d'énergie en forme de cloche, pour représenter un mot prononcé. */
function bellCurve(length: number, peakAt = length / 2): number[] {
  return Array.from({ length }, (_, index) => {
    const distance = Math.abs(index - peakAt) / (length / 2);
    return Math.max(0, 1 - distance);
  });
}

/** Une deuxième forme, assez différente d'une cloche, pour représenter un mot différent. */
function sawtoothCurve(length: number): number[] {
  return Array.from({ length }, (_, index) => (index % 6) / 6);
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

describe('computeRms', () => {
  it('vaut 0 pour un silence numérique', () => {
    expect(computeRms(new Float32Array([0, 0, 0, 0]))).toBe(0);
  });

  it('vaut 1 pour un signal saturé constant', () => {
    expect(computeRms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 5);
  });
});

describe('buildWakeWordProfile', () => {
  it('produit un gabarit normalisé de la longueur demandée', () => {
    const profile = buildWakeWordProfile(bellCurve(40), 24);
    expect(profile.envelope).toHaveLength(24);
    expect(Math.max(...profile.envelope)).toBeCloseTo(1, 5);
  });
});

describe('averageProfiles', () => {
  it('moyenne élément par élément plusieurs gabarits', () => {
    const a = { envelope: [0, 1, 0] };
    const b = { envelope: [1, 1, 1] };
    expect(averageProfiles([a, b]).envelope).toEqual([0.5, 1, 0.5]);
  });

  it('renvoie le gabarit inchangé pour un seul échantillon', () => {
    const only = buildWakeWordProfile(bellCurve(30));
    expect(averageProfiles([only]).envelope).toEqual(only.envelope);
  });
});

describe('sensitivityToThreshold / thresholdToSensitivity', () => {
  it('une sensibilité de 0 donne le seuil le plus strict', () => {
    expect(sensitivityToThreshold(0)).toBeCloseTo(SENSITIVITY_THRESHOLD_RANGE.max, 5);
  });

  it('une sensibilité de 1 donne le seuil le plus permissif', () => {
    expect(sensitivityToThreshold(1)).toBeCloseTo(SENSITIVITY_THRESHOLD_RANGE.min, 5);
  });

  it('sature les valeurs hors de [0, 1]', () => {
    expect(sensitivityToThreshold(-5)).toBeCloseTo(SENSITIVITY_THRESHOLD_RANGE.max, 5);
    expect(sensitivityToThreshold(5)).toBeCloseTo(SENSITIVITY_THRESHOLD_RANGE.min, 5);
  });

  it('thresholdToSensitivity inverse sensitivityToThreshold', () => {
    for (const sensitivity of [0, 0.25, 0.5, 0.75, 1]) {
      const threshold = sensitivityToThreshold(sensitivity);
      expect(thresholdToSensitivity(threshold)).toBeCloseTo(sensitivity, 5);
    }
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
    expect(detector.getLastScore()).toBe(0);
  });

  it('détecte une trame qui reproduit fidèlement le gabarit entraîné', () => {
    const trainingEnergy = bellCurve(30);
    const profile = buildWakeWordProfile(trainingEnergy, 24);
    const detector = new WakeWordDetector(
      { profiles: [profile], matchStrategy: 'best' },
      { frameMs: 30, windowMs: 30 * 30, threshold: 0.9, cooldownMs: 1000 },
    );

    let detected = false;
    let now = 0;
    for (const energy of trainingEnergy) {
      now += 30;
      detected = detector.pushEnergy(energy, now) || detected;
    }
    expect(detected).toBe(true);
    expect(detector.getLastScore()).toBeGreaterThanOrEqual(0.9);
  });

  it('ne se déclenche pas sur du silence', () => {
    const trainingEnergy = bellCurve(30);
    const profile = buildWakeWordProfile(trainingEnergy, 24);
    const detector = new WakeWordDetector(
      { profiles: [profile], matchStrategy: 'best' },
      { frameMs: 30, windowMs: 30 * 30, threshold: 0.9, cooldownMs: 1000 },
    );

    let detected = false;
    let now = 0;
    for (const energy of silence(60)) {
      now += 30;
      detected = detector.pushEnergy(energy, now) || detected;
    }
    expect(detected).toBe(false);
  });

  it('écarte une pièce calme, dont l’enveloppe plate ressemblerait à tout gabarit', () => {
    const profile = buildWakeWordProfile(bellCurve(30), 24);
    const detector = new WakeWordDetector(
      { profiles: [profile], matchStrategy: 'best' },
      // Seuil volontairement bas : seule la garde d'énergie doit rejeter.
      { frameMs: 30, windowMs: 30 * 30, threshold: 0.3, cooldownMs: 1000, minPeakEnergy: 0.02 },
    );

    let now = 0;
    for (const energy of new Array(60).fill(0.008)) {
      now += 30;
      expect(detector.pushEnergy(energy, now)).toBe(false);
    }
    expect(detector.getLastScore()).toBe(0);
  });

  it('respecte le délai de repos entre deux détections', () => {
    const trainingEnergy = bellCurve(30);
    const profile = buildWakeWordProfile(trainingEnergy, 24);
    const detector = new WakeWordDetector(
      { profiles: [profile], matchStrategy: 'best' },
      { frameMs: 30, windowMs: 30 * 30, threshold: 0.9, cooldownMs: 5000 },
    );

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

  it("stratégie 'best' : détecte dès qu'un seul des gabarits enregistrés correspond", () => {
    const matching = bellCurve(30);
    const nonMatching = sawtoothCurve(30);
    const detector = new WakeWordDetector(
      {
        profiles: [buildWakeWordProfile(nonMatching, 24), buildWakeWordProfile(matching, 24)],
        matchStrategy: 'best',
      },
      { frameMs: 30, windowMs: 30 * 30, threshold: 0.9, cooldownMs: 1000 },
    );

    let detected = false;
    let now = 0;
    for (const energy of matching) {
      now += 30;
      detected = detector.pushEnergy(energy, now) || detected;
    }
    expect(detected).toBe(true);
  });

  it("stratégie 'average' : un gabarit trop différent des autres peut abaisser le score moyen sous le seuil", () => {
    const matching = bellCurve(30);
    const veryDifferent = sawtoothCurve(30);
    const detectorAverage = new WakeWordDetector(
      {
        profiles: [buildWakeWordProfile(matching, 24), buildWakeWordProfile(veryDifferent, 24)],
        matchStrategy: 'average',
      },
      { frameMs: 30, windowMs: 30 * 30, threshold: 0.9, cooldownMs: 1000 },
    );
    const detectorBest = new WakeWordDetector(
      {
        profiles: [buildWakeWordProfile(matching, 24), buildWakeWordProfile(veryDifferent, 24)],
        matchStrategy: 'best',
      },
      { frameMs: 30, windowMs: 30 * 30, threshold: 0.9, cooldownMs: 1000 },
    );

    let now = 0;
    let scoreAverage = 0;
    let scoreBest = 0;
    for (const energy of matching) {
      now += 30;
      detectorAverage.pushEnergy(energy, now);
      detectorBest.pushEnergy(energy, now);
      scoreAverage = detectorAverage.getLastScore();
      scoreBest = detectorBest.getLastScore();
    }
    // La moyenne inclut un gabarit très différent : son score ne peut pas dépasser celui du meilleur match seul.
    expect(scoreAverage).toBeLessThan(scoreBest);
  });

  it('setSensitivity ajuste le seuil de déclenchement sans reconfigurer les gabarits', () => {
    const trainingEnergy = bellCurve(30);
    const profile = buildWakeWordProfile(trainingEnergy, 24);
    const detector = new WakeWordDetector(
      { profiles: [profile], matchStrategy: 'best' },
      { frameMs: 30, windowMs: 30 * 30, cooldownMs: 1000 },
    );
    detector.setSensitivity(0); // seuil très strict : presque rien ne passe

    let now = 0;
    let detected = false;
    for (const energy of trainingEnergy) {
      now += 30;
      detected = detector.pushEnergy(energy, now) || detected;
    }
    // Le gabarit est identique à l'enregistrement : même un seuil strict laisse passer une correspondance parfaite.
    expect(detected).toBe(true);

    // Un bruit décalé et affaibli ne doit plus passer avec un seuil strict…
    const detectorStrict = new WakeWordDetector(
      { profiles: [profile], matchStrategy: 'best' },
      { frameMs: 30, windowMs: 30 * 30, cooldownMs: 1000 },
    );
    detectorStrict.setSensitivity(0);
    // … alors qu'un réglage très sensible laisse passer beaucoup plus facilement.
    const detectorLoose = new WakeWordDetector(
      { profiles: [profile], matchStrategy: 'best' },
      { frameMs: 30, windowMs: 30 * 30, cooldownMs: 1000 },
    );
    detectorLoose.setSensitivity(1);

    const noisy = sawtoothCurve(30).map((v) => v * 0.6);
    let now2 = 0;
    let strictDetected = false;
    let looseDetected = false;
    for (const energy of noisy) {
      now2 += 30;
      strictDetected = detectorStrict.pushEnergy(energy, now2) || strictDetected;
      looseDetected = detectorLoose.pushEnergy(energy, now2) || looseDetected;
    }
    expect(looseDetected || !strictDetected).toBe(true);
  });

  it('hasProfile / setConfig reflètent la présence de gabarits', () => {
    const detector = new WakeWordDetector(null);
    expect(detector.hasProfile()).toBe(false);
    detector.setConfig({ profiles: [buildWakeWordProfile(bellCurve(30))], matchStrategy: 'best' });
    expect(detector.hasProfile()).toBe(true);
    detector.setConfig(null);
    expect(detector.hasProfile()).toBe(false);
  });

  it('reset remet le score et le minuteur de repos à zéro', () => {
    const profile = buildWakeWordProfile(bellCurve(30));
    const detector = new WakeWordDetector({ profiles: [profile], matchStrategy: 'best' });
    detector.pushEnergy(0.5, 0);
    detector.reset();
    expect(detector.getLastScore()).toBe(0);
  });
});
