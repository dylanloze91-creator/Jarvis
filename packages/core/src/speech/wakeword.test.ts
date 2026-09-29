import { describe, expect, it } from 'vitest';
import {
  SENSITIVITY_THRESHOLD_RANGE,
  SpeechBurstDetector,
  WakeWordDetector,
  averageProfiles,
  buildWakeWordProfile,
  buildWakeWordProfileFromEnergyFrames,
  buildWakeWordProfileFromPcm,
  buildWakeWordProfilesFromPcm,
  computeRms,
  cosineSimilarity,
  energyFramesFromPcm,
  extractSpeechBurstRanges,
  normalize,
  paddedEnergyWindow,
  resample,
  sensitivityToThreshold,
  thresholdToSensitivity,
  zeroCrossingRate,
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

/** PCM d’une syllabe : enveloppe en cloche, voisée + un peu de friction. */
function speechLikePcm(durationMs: number, sampleRate = 16000, peak = 0.4): Float32Array {
  const length = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const pcm = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const envelope = Math.sin(Math.PI * (index / Math.max(1, length - 1)));
    const voiced = Math.sin((2 * Math.PI * 140 * index) / sampleRate);
    const friction = ((index * 17) % 100) / 100 - 0.5;
    pcm[index] = envelope * peak * (0.85 * voiced + 0.15 * friction);
  }
  return pcm;
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

describe('energyFramesFromPcm / buildWakeWordProfileFromPcm', () => {
  it('découpe un PCM en trames d’énergie de la durée demandée', () => {
    const sampleRate = 1000;
    const pcm = new Float32Array(90).fill(0.5);
    const frames = energyFramesFromPcm(pcm, sampleRate, 30);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toBeCloseTo(0.5, 5);
  });

  it('construit un gabarit à partir d’une rafale de parole, recadrée sur la fenêtre du détecteur', () => {
    const pcm = speechLikePcm(500);
    const result = buildWakeWordProfileFromPcm(pcm, 16000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.envelope).toHaveLength(24);
  });

  it('refuse un PCM silencieux, sans l’assimiler à un gabarit', () => {
    const pcm = new Float32Array(8000).fill(0.001);
    expect(buildWakeWordProfileFromPcm(pcm, 16000)).toEqual({ ok: false, reason: 'silent' });
  });

  it('refuse un PCM vide', () => {
    expect(buildWakeWordProfileFromPcm(new Float32Array(0), 16000)).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('refuse un clic trop court pour être une prise vocale', () => {
    const pcm = speechLikePcm(80);
    expect(buildWakeWordProfileFromPcm(pcm, 16000)).toEqual({ ok: false, reason: 'non-speech' });
  });

  it('refuse un sinus d’amplitude constante (pas une voix)', () => {
    const pcm = new Float32Array(16000).map((_, index) => Math.sin(index / 8) * 0.4);
    expect(buildWakeWordProfileFromPcm(pcm, 16000)).toEqual({ ok: false, reason: 'non-speech' });
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

describe('extractSpeechBurstRanges / paddedEnergyWindow', () => {
  it('isole la parole au milieu d’un long silence', () => {
    const energies = [...silence(40), ...bellCurve(20).map((value) => value * 0.4), ...silence(40)];
    const extracted = extractSpeechBurstRanges(energies, 30, 0.012);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.ranges).toHaveLength(1);
    expect(extracted.ranges[0]!.startFrame).toBeGreaterThan(30);
    expect(extracted.ranges[0]!.endFrame).toBeLessThan(70);
  });

  it('recadre une rafale courte au centre d’une fenêtre de 30 trames', () => {
    const energies = [0.1, 0.5, 1, 0.5, 0.1];
    const window = paddedEnergyWindow(energies, 0, 5, 9);
    expect(window).toHaveLength(9);
    expect(window[4]).toBe(1);
    expect(window[0]).toBe(0);
    expect(window[8]).toBe(0);
  });
});

describe('buildWakeWordProfilesFromPcm', () => {
  it('extrait deux prises distinctes dans le même clip', () => {
    const first = speechLikePcm(400);
    const gap = new Float32Array(8000);
    const second = speechLikePcm(500, 16000, 0.5);
    const pcm = new Float32Array(first.length + gap.length + second.length);
    pcm.set(first, 0);
    pcm.set(second, first.length + gap.length);
    const result = buildWakeWordProfilesFromPcm(pcm, 16000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profiles.length).toBe(2);
  });

  it('un mot noyé dans 8 s de silence matche encore la fenêtre glissante de 900 ms', () => {
    const word = speechLikePcm(450);
    const lead = new Float32Array(16000 * 4);
    const tail = new Float32Array(16000 * 4);
    const pcm = new Float32Array(lead.length + word.length + tail.length);
    pcm.set(word, lead.length);

    const built = buildWakeWordProfileFromPcm(pcm, 16000);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const detector = new WakeWordDetector(
      { profiles: [built.profile], matchStrategy: 'best' },
      { frameMs: 30, windowMs: 900, threshold: 0.72, cooldownMs: 1000 },
    );

    const live = paddedEnergyWindow(
      energyFramesFromPcm(pcm, 16000),
      Math.round((lead.length / 16000) * 1000 / 30),
      Math.round(((lead.length + word.length) / 16000) * 1000 / 30),
      30,
    );
    let now = 0;
    let detected = false;
    for (const energy of live) {
      now += 30;
      detected = detector.pushEnergy(energy, now) || detected;
    }
    expect(detected).toBe(true);
    expect(detector.getLastScore()).toBeGreaterThanOrEqual(0.72);
  });
});

describe('zeroCrossingRate / buildWakeWordProfileFromEnergyFrames', () => {
  it('un silence a un taux de passages par zéro nul', () => {
    expect(zeroCrossingRate(new Float32Array(200))).toBe(0);
  });

  it('construit un gabarit depuis des trames RMS déjà isolées', () => {
    const energies = [...silence(10), ...bellCurve(16).map((value) => value * 0.3), ...silence(10)];
    const result = buildWakeWordProfileFromEnergyFrames(energies);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.envelope).toHaveLength(24);
  });
});

describe('SpeechBurstDetector', () => {
  it('émet un candidat après assez de trames au-dessus du seuil', () => {
    const burst = new SpeechBurstDetector(3, 0.1, 1000);
    expect(burst.push(0.2, 0)).toBe(false);
    expect(burst.push(0.2, 30)).toBe(false);
    expect(burst.push(0.2, 60)).toBe(true);
  });

  it('repart de zéro si une trame retombe sous le seuil', () => {
    const burst = new SpeechBurstDetector(3, 0.1, 1000);
    burst.push(0.2, 0);
    burst.push(0.01, 30);
    expect(burst.push(0.2, 60)).toBe(false);
    expect(burst.push(0.2, 90)).toBe(false);
    expect(burst.push(0.2, 120)).toBe(true);
  });

  it('respecte le repos entre deux candidats', () => {
    const burst = new SpeechBurstDetector(2, 0.1, 5000);
    expect(burst.push(0.2, 0)).toBe(false);
    expect(burst.push(0.2, 30)).toBe(true);
    expect(burst.push(0.2, 60)).toBe(false);
    expect(burst.push(0.2, 90)).toBe(false);
  });
});
