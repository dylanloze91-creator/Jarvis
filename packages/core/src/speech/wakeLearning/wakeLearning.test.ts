import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WAKE_SAMPLE_CAP,
  MIN_NEGATIVES_FOR_VERIFIER,
  MIN_POSITIVES_FOR_VERIFIER,
  RESCUE_THRESHOLD_BOUNDS,
  VETO_THRESHOLD_BOUNDS,
  WAKE_CLIP_SAMPLES,
  WAKE_FEATURE_SIZE,
  WakeLabeler,
  classifyWakeOutcome,
  clampRescueThreshold,
  clampVetoThreshold,
  decideWakeCandidate,
  fixedClip,
  parseWakeVerifierModel,
  poolWakeEmbeddings,
  pruneWakeStats,
  samplesOverCap,
  scoreWakeFeatures,
  shouldRetrain,
  summarizeWakeStats,
  trainWakeVerifier,
  wakeClipFromWindow,
  type WakeSampleEntry,
  type WakeTrainingSample,
} from './index.js';

/** Générateur pseudo-aléatoire déterministe. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function cluster(center: number, count: number, label: 0 | 1, seed: number, spread = 0.3): WakeTrainingSample[] {
  const random = rng(seed);
  return Array.from({ length: count }, () => ({
    label,
    features: Array.from({ length: WAKE_FEATURE_SIZE }, (_, d) => (d % 7 === 0 ? center : 0) + (random() - 0.5) * spread),
  }));
}

describe('labellisation', () => {
  it('classe les issues : commande, vide, hallucination, annulation, erreur', () => {
    expect(classifyWakeOutcome('quelle heure est-il ?')).toBe('command');
    expect(classifyWakeOutcome('  ')).toBe('empty');
    expect(classifyWakeOutcome('Sous-titres réalisés par la communauté d’Amara.org')).toBe('hallucination');
    expect(classifyWakeOutcome('…')).toBe('hallucination');
    expect(classifyWakeOutcome('Laisse tomber.')).toBe('cancelled');
    expect(classifyWakeOutcome('quelle heure est-il', true)).toBe('error');
  });

  it('réveil suivi d’une commande → positif et réveil réussi', () => {
    const labeler = new WakeLabeler(8000);
    labeler.candidate({ id: 'a', at: 0, accepted: true });
    const out = labeler.outcome('a', 'command', 3000);
    expect(out.labels).toEqual([{ id: 'a', label: 'positive', reason: 'command' }]);
    expect(out.stats).toEqual(['success']);
  });

  it('réveil annulé → négatif tout de suite', () => {
    const labeler = new WakeLabeler(8000);
    labeler.candidate({ id: 'a', at: 0, accepted: true });
    const out = labeler.outcome('a', 'cancelled', 2000);
    expect(out.labels).toEqual([{ id: 'a', label: 'negative', reason: 'cancelled' }]);
    expect(out.stats).toEqual(['false-wake']);
  });

  it('réveil vide → négatif seulement après la fenêtre de reprise', () => {
    const labeler = new WakeLabeler(8000);
    labeler.candidate({ id: 'a', at: 0, accepted: true });
    expect(labeler.outcome('a', 'empty', 2000).labels).toEqual([]);
    expect(labeler.expire(5000).labels).toEqual([]);
    const out = labeler.expire(9000);
    expect(out.labels).toEqual([{ id: 'a', label: 'negative', reason: 'empty' }]);
    expect(out.stats).toEqual(['false-wake']);
  });

  it('réveil vide suivi d’un réveil réussi → douteux, ignoré', () => {
    const labeler = new WakeLabeler(8000);
    labeler.candidate({ id: 'a', at: 0, accepted: true });
    labeler.outcome('a', 'hallucination', 2000);
    labeler.candidate({ id: 'b', at: 4000, accepted: true });
    const out = labeler.outcome('b', 'command', 6000);
    expect(out.discard).toContain('a');
    expect(out.labels).toEqual([{ id: 'b', label: 'positive', reason: 'command' }]);
    expect(out.stats).toEqual(['success']);
  });

  it('raté rattrapé : « Jarvis » répété qui réveille → le premier essai devient positif', () => {
    const labeler = new WakeLabeler(8000);
    labeler.candidate({ id: 'miss', at: 1000, accepted: false });
    labeler.candidate({ id: 'ok', at: 4000, accepted: true });
    const out = labeler.outcome('ok', 'command', 6000);
    expect(out.labels).toEqual([
      { id: 'ok', label: 'positive', reason: 'command' },
      { id: 'miss', label: 'positive', reason: 'retry' },
    ]);
    expect(out.stats).toEqual(['success', 'miss']);
  });

  it('quasi-réveil juste avant le réveil (même « Jarvis » vu par les deux détecteurs) → pas un raté', () => {
    const labeler = new WakeLabeler(8000);
    labeler.candidate({ id: 'same', at: 1000, accepted: false });
    labeler.candidate({ id: 'ok', at: 1800, accepted: true });
    const out = labeler.outcome('ok', 'command', 4000);
    expect(out.labels).toEqual([{ id: 'ok', label: 'positive', reason: 'command' }]);
    expect(out.discard).toContain('same');
    expect(out.stats).toEqual(['success']);
  });

  it('candidat refusé sans reprise, ou reprise trop tardive → ignoré', () => {
    const labeler = new WakeLabeler(8000);
    labeler.candidate({ id: 'old', at: 0, accepted: false });
    labeler.candidate({ id: 'ok', at: 20_000, accepted: true });
    const out = labeler.outcome('ok', 'command', 22_000);
    expect(out.labels.map((label) => label.id)).toEqual(['ok']);
    expect(out.stats).toEqual(['success']);
  });

  it('erreur de transcription → ignoré, ni positif ni négatif', () => {
    const labeler = new WakeLabeler(8000);
    labeler.candidate({ id: 'a', at: 0, accepted: true });
    const out = labeler.outcome('a', 'error', 1000);
    expect(out.labels).toEqual([]);
    expect(out.discard).toEqual(['a']);
  });
});

describe('entraînement du vérificateur', () => {
  it('pas de modèle sans assez d’exemples (comportement 0.4.16)', () => {
    expect(trainWakeVerifier(cluster(2, MIN_POSITIVES_FOR_VERIFIER - 1, 1, 1).concat(cluster(-2, 30, 0, 2)))).toBeNull();
    expect(trainWakeVerifier(cluster(2, 30, 1, 1).concat(cluster(-2, MIN_NEGATIVES_FOR_VERIFIER - 1, 0, 2)))).toBeNull();
  });

  it('sépare deux classes et choisit des seuils dans les bornes', () => {
    const samples = [...cluster(1, 40, 1, 3), ...cluster(-1, 40, 0, 4)];
    const started = Date.now();
    const model = trainWakeVerifier(samples, { now: 42 })!;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(model.trainedAt).toBe(42);
    expect(model.positives).toBe(40);
    expect(model.vetoEnabled).toBe(true);
    expect(model.cvRecall).toBeGreaterThanOrEqual(0.97);
    expect(model.vetoThreshold).toBeGreaterThanOrEqual(VETO_THRESHOLD_BOUNDS.min);
    expect(model.vetoThreshold).toBeLessThanOrEqual(VETO_THRESHOLD_BOUNDS.max);
    expect(model.rescueThreshold).not.toBeNull();
    expect(model.rescueThreshold!).toBeGreaterThanOrEqual(RESCUE_THRESHOLD_BOUNDS.min);
    expect(model.rescueThreshold!).toBeLessThanOrEqual(RESCUE_THRESHOLD_BOUNDS.max);
    expect(scoreWakeFeatures(model, cluster(1, 1, 1, 99)[0]!.features)).toBeGreaterThan(0.9);
    expect(scoreWakeFeatures(model, cluster(-1, 1, 0, 98)[0]!.features)).toBeLessThan(0.1);
  });

  it('classes mêlées : veto désactivé, pas de rattrapage', () => {
    const samples = [...cluster(0, 30, 1, 5, 2), ...cluster(0, 30, 0, 6, 2)];
    const model = trainWakeVerifier(samples)!;
    expect(model.rescueThreshold).toBeNull();
    // Le veto ne s'active que s'il garde ≥ 97 % des vrais réveils en validation croisée.
    if (model.vetoEnabled) expect(model.cvRecall).toBeGreaterThanOrEqual(0.97);
  });

  it('ignore les caractéristiques invalides', () => {
    const bad = { label: 1 as const, features: [1, 2, 3] };
    const nan = { label: 0 as const, features: new Array(WAKE_FEATURE_SIZE).fill(Number.NaN) };
    const model = trainWakeVerifier([...cluster(1, 10, 1, 7), ...cluster(-1, 10, 0, 8), bad, nan])!;
    expect(model.positives).toBe(10);
    expect(model.negatives).toBe(10);
  });
});

describe('bornes et décisions', () => {
  it('les seuils restent dans leurs bornes', () => {
    expect(clampVetoThreshold(0)).toBe(VETO_THRESHOLD_BOUNDS.min);
    expect(clampVetoThreshold(0.99)).toBe(VETO_THRESHOLD_BOUNDS.max);
    expect(clampRescueThreshold(0.1)).toBe(RESCUE_THRESHOLD_BOUNDS.min);
    expect(clampRescueThreshold(1)).toBe(RESCUE_THRESHOLD_BOUNDS.max);
  });

  it('un modèle relu avec des seuils hors bornes est ramené dans les bornes', () => {
    const model = trainWakeVerifier([...cluster(1, 20, 1, 9), ...cluster(-1, 25, 0, 10)])!;
    const parsed = parseWakeVerifierModel({ ...model, vetoThreshold: 0.95, rescueThreshold: 0.2 })!;
    expect(parsed.vetoThreshold).toBe(VETO_THRESHOLD_BOUNDS.max);
    expect(parsed.rescueThreshold).toBe(RESCUE_THRESHOLD_BOUNDS.min);
    expect(parseWakeVerifierModel({ ...model, version: 99 })).toBeNull();
    expect(parseWakeVerifierModel({ ...model, weights: [1] })).toBeNull();
  });

  it('sans modèle : réveil accepté, quasi-réveil ignoré (0.4.16)', () => {
    expect(decideWakeCandidate(null, 'detected', null)).toMatchObject({ accept: true, reason: 'base' });
    expect(decideWakeCandidate(null, 'near-miss', 0.99)).toMatchObject({ accept: false, reason: 'ignored' });
  });

  it('avec modèle : veto sous le seuil, rattrapage au-dessus', () => {
    const model = trainWakeVerifier([...cluster(1, 40, 1, 11), ...cluster(-1, 40, 0, 12)])!;
    expect(decideWakeCandidate(model, 'detected', 0.01).reason).toBe('vetoed');
    expect(decideWakeCandidate(model, 'detected', 0.9).reason).toBe('verified');
    expect(decideWakeCandidate(model, 'near-miss', 0.999).reason).toBe('rescued');
    expect(decideWakeCandidate(model, 'near-miss', 0.5).reason).toBe('ignored');
    expect(decideWakeCandidate({ ...model, vetoEnabled: false }, 'detected', 0.01).accept).toBe(true);
    expect(decideWakeCandidate({ ...model, rescueThreshold: null }, 'near-miss', 0.999).accept).toBe(false);
  });
});

describe('plafond, réentraînement, statistiques', () => {
  const entry = (id: string, label: 'positive' | 'negative', createdAt: number, source: WakeSampleEntry['source'] = 'wake'): WakeSampleEntry => ({
    id,
    label,
    source,
    createdAt,
    bytes: source === 'background' ? 0 : 64_000,
    features: [],
  });

  it('respecte le nombre maximum en gardant l’équilibre et l’enregistrement de départ', () => {
    const entries = [
      entry('e1', 'positive', 0, 'enrollment'),
      entry('p1', 'positive', 1),
      entry('p2', 'positive', 2),
      entry('p3', 'positive', 3),
      entry('n1', 'negative', 4),
    ];
    const removed = samplesOverCap(entries, { ...DEFAULT_WAKE_SAMPLE_CAP, maxClips: 3 });
    expect(removed).toEqual(['p1', 'p2']);
  });

  it('respecte la taille maximale', () => {
    const entries = Array.from({ length: 10 }, (_, index) => entry(`n${index}`, 'negative', index));
    const removed = samplesOverCap(entries, { ...DEFAULT_WAKE_SAMPLE_CAP, maxClipBytes: 64_000 * 4 });
    expect(removed).toHaveLength(6);
    expect(removed[0]).toBe('n0');
  });

  it('plafonne les fonds sonores à part', () => {
    const entries = Array.from({ length: 5 }, (_, index) => entry(`b${index}`, 'negative', index, 'background'));
    expect(samplesOverCap(entries, { ...DEFAULT_WAKE_SAMPLE_CAP, maxBackground: 2 })).toEqual(['b0', 'b1', 'b2']);
  });

  it('réentraîne après 5 nouveaux exemples, ou sur demande', () => {
    expect(shouldRetrain(4)).toBe(false);
    expect(shouldRetrain(5)).toBe(true);
    expect(shouldRetrain(0, true)).toBe(true);
  });

  it('compte sur 7 jours seulement', () => {
    const day = 24 * 3600 * 1000;
    const now = 30 * day;
    const events = [
      { at: now - 1000, kind: 'success' as const },
      { at: now - 2 * day, kind: 'miss' as const },
      { at: now - 3 * day, kind: 'false-wake' as const },
      { at: now - 8 * day, kind: 'success' as const },
    ];
    expect(summarizeWakeStats(events, now)).toEqual({ successes: 1, misses: 1, falseWakes: 1, days: 7 });
    expect(pruneWakeStats(events, now)).toHaveLength(3);
  });
});

describe('extraits et caractéristiques', () => {
  it('extrait fixe de 2 s terminé juste après le mot (Vosk)', () => {
    const pcm = new Float32Array(16000 * 4).map((_, index) => (index < 16000 ? 1 : 0.5));
    const clip = wakeClipFromWindow({ pcm, sampleRate: 16000, commandOffset: 16000 });
    expect(clip.length).toBe(WAKE_CLIP_SAMPLES);
    // fin du mot à 1 s + 0,15 s : 1,15 s d'audio, précédé de 0,85 s de silence
    expect(clip[0]).toBe(0);
    expect(clip[WAKE_CLIP_SAMPLES - 1]).toBe(0.5);
  });

  it('extrait openWakeWord : les 2 dernières secondes de la fenêtre', () => {
    const pcm = new Float32Array(16000 * 3).map((_, index) => index);
    const clip = fixedClip(pcm);
    expect(clip[0]).toBe(16000);
    expect(clip.at(-1)).toBe(16000 * 3 - 1);
  });

  it('résume les embeddings en moyenne, maximum, écart-type', () => {
    const a = new Float32Array(96).fill(1);
    const b = new Float32Array(96).fill(3);
    const features = poolWakeEmbeddings([a, b]);
    expect(features).toHaveLength(WAKE_FEATURE_SIZE);
    expect(features[0]).toBe(2);
    expect(features[96]).toBe(3);
    expect(features[192]).toBe(1);
  });
});
