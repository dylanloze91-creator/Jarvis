import { describe, expect, it, vi } from 'vitest';
import { WAKE_CLIP_SAMPLES, WAKE_FEATURE_SIZE, type WakeCandidateReport } from '@jarvis/core';

vi.mock('../audioCapture', () => ({ microphone: {} }));
vi.mock('./featureRunner', () => ({ computeWakeFeatures: async () => null }));

const { WakeTakeDetector } = await import('./enrollment');
const { WakeLearningSession } = await import('./session');
const { indicatorBarHeights } = await import('../../indicator/levels');

const RATE = 16_000;
const tone = (seconds: number, amplitude = 0.2): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE));
const silence = (seconds: number): Float32Array => new Float32Array(Math.round(seconds * RATE));

function feed(detector: InstanceType<typeof WakeTakeDetector>, pcm: Float32Array) {
  for (let offset = 0; offset < pcm.length; offset += 1024) {
    const result = detector.push(pcm.subarray(offset, offset + 1024), RATE);
    if (result.status !== 'pending') return result;
  }
  return { status: 'pending' as const };
}

describe('prise d’enrôlement', () => {
  it('rend 2 s qui finissent juste après le mot', () => {
    const detector = new WakeTakeDetector();
    const result = feed(detector, new Float32Array([...silence(1), ...tone(0.5), ...silence(1)]));
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.clip).toHaveLength(WAKE_CLIP_SAMPLES);
    // Le mot finit ~150 ms avant la fin de l'extrait.
    const tail = result.clip.subarray(WAKE_CLIP_SAMPLES - Math.round(0.1 * RATE));
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(0.01);
    const word = result.clip.subarray(WAKE_CLIP_SAMPLES - Math.round(0.5 * RATE), WAKE_CLIP_SAMPLES - Math.round(0.25 * RATE));
    expect(Math.max(...word.map(Math.abs))).toBeGreaterThan(0.1);
  });

  it('ignore un clic bref et refuse une phrase trop longue', () => {
    expect(feed(new WakeTakeDetector(), new Float32Array([...tone(0.05), ...silence(1)])).status).toBe('pending');
    expect(feed(new WakeTakeDetector(), tone(2.5)).status).toBe('too-long');
  });
});

function report(accept: boolean, features: number[] | null = Array(WAKE_FEATURE_SIZE).fill(0.5)): WakeCandidateReport {
  return {
    kind: accept ? 'detected' : 'near-miss',
    decision: { accept, reason: accept ? 'base' : 'ignored', probability: null },
    clip: new Float32Array(WAKE_CLIP_SAMPLES),
    features,
  } as WakeCandidateReport;
}

function fakeApi() {
  return {
    status: vi.fn(),
    addSample: vi.fn(async () => ({ model: null, retrained: false })),
    recordStats: vi.fn(async () => undefined),
    model: vi.fn(async () => null),
    retrain: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
  };
}

describe('session d’apprentissage', () => {
  it('un réveil suivi d’une vraie commande devient un positif', () => {
    const api = fakeApi();
    let now = 1_000;
    const session = new WakeLearningSession(() => api as never, undefined, async () => null, () => now);
    session.onCandidate(report(true));
    now += 3_000;
    session.outcome('quelle heure est-il');
    expect(api.addSample).toHaveBeenCalledWith(expect.objectContaining({ label: 'positive', source: 'wake' }));
    expect(api.recordStats).toHaveBeenCalledWith(['success']);
  });

  it('un « Jarvis » refusé puis répété avec succès devient un raté rattrapé', () => {
    const api = fakeApi();
    let now = 1_000;
    const session = new WakeLearningSession(() => api as never, undefined, async () => null, () => now);
    session.onCandidate(report(false));
    now += 2_000;
    session.onCandidate(report(true));
    now += 2_000;
    session.outcome('mets de la musique');
    const sources = api.addSample.mock.calls.map(([input]) => (input as { source: string }).source);
    expect(sources.sort()).toEqual(['retry', 'wake']);
    expect(api.recordStats).toHaveBeenCalledWith(['success', 'miss']);
  });

  it('un réveil annulé devient un négatif ; une erreur de transcription est ignorée', () => {
    const api = fakeApi();
    let now = 1_000;
    const session = new WakeLearningSession(() => api as never, undefined, async () => null, () => now);
    session.onCandidate(report(true));
    session.outcome('laisse tomber');
    expect(api.addSample).toHaveBeenCalledWith(expect.objectContaining({ label: 'negative' }));
    api.addSample.mockClear();
    now += 20_000;
    session.onCandidate(report(true));
    session.outcome('', true);
    now += 20_000;
    session.onCandidate(report(true));
    expect(api.addSample).not.toHaveBeenCalled();
  });

  it('sans caractéristiques (modèles absents), rien n’est envoyé', () => {
    const api = fakeApi();
    const session = new WakeLearningSession(() => api as never, undefined, async () => null, () => 1_000);
    session.onCandidate(report(true, null));
    session.outcome('quelle heure est-il');
    expect(api.addSample).not.toHaveBeenCalled();
    expect(api.recordStats).toHaveBeenCalledWith(['success']);
  });
});

describe('barres de l’indicateur', () => {
  it('sont plates au repos et montent avec la voix, plus haut au centre', () => {
    expect(new Set(indicatorBarHeights([], 7))).toEqual(new Set([4]));
    const heights = indicatorBarHeights([0.2, 0.2, 0.2, 0.2], 7);
    expect(heights[3]).toBeGreaterThan(heights[0]!);
    expect(Math.max(...heights)).toBeLessThanOrEqual(22);
  });
});
