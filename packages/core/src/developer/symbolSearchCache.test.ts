import { describe, expect, it } from 'vitest';
import {
  cachedCodeSearch,
  invalidateSymbolResolutionCache,
  resetSymbolResolutionCache,
  setStoredSymbolContext,
  getStoredSymbolContext,
  symbolPlanCacheKey,
} from './symbolSearchCache.js';
import type { ReviewedPlan } from './taskPolicy.js';

const ROOT = '/tmp/projet-test';
const PLAN: ReviewedPlan = {
  summary: 's',
  criteria: [],
  files: [{ path: 'a.ts', action: 'edit', reason: '', core: null, exists: true, problem: null }],
  tests: ['typecheck'],
};

describe('symbolSearchCache', () => {
  it('ne relance pas la même recherche tant que la sandbox est intacte', async () => {
    resetSymbolResolutionCache(ROOT);
    let calls = 0;
    const run = async () => {
      calls += 1;
      return [{ file: 'b.ts', line: 1, text: 'x' }];
    };
    await cachedCodeSearch(ROOT, 'sym', run);
    await cachedCodeSearch(ROOT, 'sym', run);
    expect(calls).toBe(1);
    invalidateSymbolResolutionCache(ROOT);
    await cachedCodeSearch(ROOT, 'sym', run);
    expect(calls).toBe(2);
  });

  it('invalide le contexte mémorisé quand un fichier change', () => {
    resetSymbolResolutionCache(ROOT);
    const key = symbolPlanCacheKey('demande', PLAN);
    setStoredSymbolContext(ROOT, key, { block: 'bloc', resolutions: [], plan: PLAN });
    expect(getStoredSymbolContext(ROOT, key)?.block).toBe('bloc');
    invalidateSymbolResolutionCache(ROOT);
    expect(getStoredSymbolContext(ROOT, key)).toBeNull();
  });
});
