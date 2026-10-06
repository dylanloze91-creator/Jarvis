import { describe, expect, it } from 'vitest';
import type { ManualChunk, ManualIndex } from './types.js';
import { MANUAL_INDEX_VERSION } from './types.js';
import {
  cosineSimilarity,
  extractErrorCodes,
  formatManualBlock,
  keywordScore,
  retrieveManualPassages,
  scoreChunk,
} from './retrieve.js';

const chunk = (id: string, section: string, text: string, extra?: Partial<ManualChunk>): ManualChunk => ({
  id,
  source: 'a.md',
  section,
  text,
  meta: { tags: ['all'], ...extra?.meta },
  ...extra,
});

describe('extractErrorCodes', () => {
  it('trouve les codes TS', () => {
    expect(extractErrorCodes('erreur TS2588 ligne 3')).toEqual(['TS2588']);
  });
});

describe('keywordScore', () => {
  it('score plus haut si les mots de la requête apparaissent', () => {
    const c = chunk('1', 'Vitest', 'utilise toBeCloseTo avec des décimales');
    expect(keywordScore(['vitest', 'toBeCloseTo'], c)).toBeGreaterThanOrEqual(0.5);
    expect(keywordScore(['tetris'], c)).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('vecteurs identiques → 1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });
});

describe('retrieveManualPassages avec embeddings factices', () => {
  const index: ManualIndex = {
    version: MANUAL_INDEX_VERSION,
    chunks: [
      chunk('a', 'Canvas', 'boucle requestAnimationFrame update render', {
        embedding: [1, 0, 0],
      }),
      chunk('b', 'Vitest', 'expect toBeCloseTo décimales entier', {
        embedding: [0, 1, 0],
      }),
      chunk('c', 'Autre', 'sans rapport', { embedding: [0, 0, 1] }),
    ],
  };

  it('favorise la similarité cosinus quand un vecteur requête est fourni via scoreChunk', () => {
    const queryVec = [0.9, 0.1, 0];
    const scores = index.chunks.map((c) => scoreChunk(c, ['canvas'], queryVec));
    expect(scores[0]).toBeGreaterThan(scores[1]!);
  });

  it('retourne des passages bornés', () => {
    const passages = retrieveManualPassages(index, {
      text: 'canvas jeu update',
      maxPassages: 2,
      maxChars: 200,
    });
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.length).toBeLessThanOrEqual(2);
    const block = formatManualBlock(passages);
    expect(block.startsWith('Manuel pertinent')).toBe(true);
    expect(block.length).toBeLessThanOrEqual(2500);
  });
});
