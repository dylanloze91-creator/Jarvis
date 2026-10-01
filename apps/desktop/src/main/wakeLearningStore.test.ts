import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WAKE_CLIP_SAMPLES, WAKE_FEATURE_SIZE } from '@jarvis/core';
import { WakeLearningStore, validateSampleInput } from './wakeLearningStore.js';
import type { WakeLearningSampleInput } from '../shared/ipc.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-wake-'));
  dirs.push(dir);
  return dir;
}

/** Deux nuages bien séparés : le vérificateur apprend vite. */
function sample(index: number, label: 'positive' | 'negative', source: WakeLearningSampleInput['source'] = 'wake'): WakeLearningSampleInput {
  const center = label === 'positive' ? 1 : -1;
  const features = Array.from({ length: WAKE_FEATURE_SIZE }, (_, k) => center + Math.sin(index * 7 + k) * 0.3);
  return {
    id: `${label}-${index}`,
    label,
    source,
    features,
    clip: source === 'background' ? undefined : new Float32Array(WAKE_CLIP_SAMPLES).fill(0.01),
  };
}

describe('validation des exemples venus du renderer', () => {
  it('refuse un identifiant qui ressemble à un chemin', () => {
    expect(validateSampleInput({ ...sample(1, 'positive'), id: '../../evil' })).toBeNull();
  });

  it('refuse des caractéristiques de mauvaise taille ou non finies', () => {
    expect(validateSampleInput({ ...sample(1, 'positive'), features: [1, 2, 3] })).toBeNull();
    const features = sample(1, 'positive').features.slice();
    features[3] = Number.NaN;
    expect(validateSampleInput({ ...sample(1, 'positive'), features })).toBeNull();
  });

  it('refuse un extrait plus long que 2 s', () => {
    expect(validateSampleInput({ ...sample(1, 'positive'), clip: new Float32Array(WAKE_CLIP_SAMPLES + 1) })).toBeNull();
  });

  it('ne garde jamais d’audio pour un fond sonore', () => {
    const input = validateSampleInput({ ...sample(1, 'negative', 'background'), clip: new Float32Array(10) });
    expect(input?.clip).toBeUndefined();
  });
});

describe('stockage local de l’apprentissage', () => {
  it('écrit les extraits sous wake-learning/clips et réentraîne après assez d’exemples', async () => {
    const root = tempRoot();
    const store = new WakeLearningStore(() => root);
    let last = null as Awaited<ReturnType<WakeLearningStore['addSample']>>;
    for (let index = 0; index < 10; index += 1) {
      await store.addSample(sample(index, 'positive'));
      last = await store.addSample(sample(index, 'negative'));
    }
    expect(readdirSync(join(root, 'wake-learning', 'clips'))).toHaveLength(20);
    expect(last?.model).not.toBeNull();
    const status = await store.status();
    expect(status.positives).toBe(10);
    expect(status.negatives).toBe(10);
    expect(status.model?.vetoThreshold).toBeGreaterThanOrEqual(0.05);
    expect(status.model?.vetoThreshold).toBeLessThanOrEqual(0.5);
  });

  it('respecte le plafond d’extraits en supprimant les plus anciens', async () => {
    const root = tempRoot();
    const store = new WakeLearningStore(() => root, undefined, { maxClips: 4, maxClipBytes: 10 * 1024 * 1024, maxBackground: 2 });
    for (let index = 0; index < 7; index += 1) await store.addSample(sample(index, 'positive'));
    const status = await store.status();
    expect(status.clips).toBe(4);
    expect(readdirSync(join(root, 'wake-learning', 'clips'))).toHaveLength(4);
    expect(await store.clipFileBytes('positive-0')).toBe(0);
    expect(await store.clipFileBytes('positive-6')).toBeGreaterThan(0);
  });

  it('Effacer supprime les extraits mais garde le vérificateur et les compteurs', async () => {
    const root = tempRoot();
    const store = new WakeLearningStore(() => root);
    for (let index = 0; index < 10; index += 1) {
      await store.addSample(sample(index, 'positive'));
      await store.addSample(sample(index, 'negative'));
    }
    await store.retrain();
    await store.recordStats(['success', 'miss']);
    const status = await store.clearSamples();
    expect(status.clips).toBe(0);
    expect(existsSync(join(root, 'wake-learning', 'clips'))).toBe(false);
    expect(status.model).not.toBeNull();
    expect(status.stats.successes).toBe(1);
  });

  it('Réinitialiser revient à la détection de base (plus de modèle, plus de fichiers)', async () => {
    const root = tempRoot();
    const store = new WakeLearningStore(() => root);
    for (let index = 0; index < 10; index += 1) {
      await store.addSample(sample(index, 'positive'));
      await store.addSample(sample(index, 'negative'));
    }
    await store.retrain();
    const status = await store.reset();
    expect(status.model).toBeNull();
    expect(await store.model()).toBeNull();
    expect(existsSync(join(root, 'wake-learning'))).toBe(false);
  });

  it('ne journalise que des nombres', async () => {
    const root = tempRoot();
    const lines: string[] = [];
    const store = new WakeLearningStore(() => root, (line) => lines.push(line));
    for (let index = 0; index < 10; index += 1) {
      await store.addSample(sample(index, 'positive'));
      await store.addSample(sample(index, 'negative'));
    }
    await store.reset();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/positive-\d|negative-\d|\.wav|[A-Za-z]:\\|\/tmp\//);
    }
  });
});
