import type { CodeSearchMatch, SymbolResolution } from './editSymbolContext.js';
import type { ReviewedPlan } from './taskPolicy.js';

export interface StoredSymbolContext {
  block: string;
  resolutions: SymbolResolution[];
  plan: ReviewedPlan;
}

type Stored = {
  planKey: string;
  bump: number;
  result: StoredSymbolContext;
};

const bumps = new Map<string, number>();
const patternHits = new Map<string, Map<string, readonly CodeSearchMatch[]>>();
const contexts = new Map<string, Stored>();

export function symbolPlanCacheKey(request: string, plan: ReviewedPlan): string {
  const files = plan.files.map((f) => `${f.action}:${f.path}`).join('\n');
  return `${request.trim()}\n${plan.summary}\n${files}`;
}

function bumpFor(root: string): number {
  return bumps.get(root) ?? 0;
}

/** Après une écriture dans la sandbox : les recherches et le contexte mémorisé sont oubliés. */
export function invalidateSymbolResolutionCache(root: string): void {
  bumps.set(root, bumpFor(root) + 1);
  patternHits.delete(root);
  contexts.delete(root);
}

export function getStoredSymbolContext(
  root: string,
  planKey: string,
): StoredSymbolContext | null {
  const hit = contexts.get(root);
  if (!hit || hit.planKey !== planKey || hit.bump !== bumpFor(root)) return null;
  return hit.result;
}

export function setStoredSymbolContext(
  root: string,
  planKey: string,
  result: StoredSymbolContext,
): void {
  contexts.set(root, { planKey, bump: bumpFor(root), result });
}

/** Mémorise les résultats git grep par motif tant que la sandbox n’a pas changé. */
export async function cachedCodeSearch(
  root: string,
  pattern: string,
  run: () => Promise<readonly CodeSearchMatch[]>,
): Promise<readonly CodeSearchMatch[]> {
  const key = `${bumpFor(root)}:${pattern}`;
  let map = patternHits.get(root);
  if (!map) {
    map = new Map();
    patternHits.set(root, map);
  }
  const hit = map.get(key);
  if (hit) return hit;
  const matches = await run();
  map.set(key, matches);
  return matches;
}

/** Test uniquement : remet le cache d’une racine à zéro. */
export function resetSymbolResolutionCache(root: string): void {
  bumps.delete(root);
  patternHits.delete(root);
  contexts.delete(root);
}
