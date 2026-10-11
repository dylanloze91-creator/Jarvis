import type { MissionKind } from './router.js';
import type { SpecialistRole } from './roles.js';

/** Catégorie mesurée sur de vraies missions ou tâches (pas le nom du modèle). */
export type ModelRunCategory = `role:${SpecialistRole}:mission:${MissionKind}` | 'role:CODER:code-task';

export interface ModelRunRecord {
  at: number;
  model: string;
  category: ModelRunCategory;
  success: boolean;
}

const MAX_RUNS = 240;

export function modelRunCategory(
  role: SpecialistRole,
  kind: MissionKind | 'code-task',
): ModelRunCategory {
  if (kind === 'code-task') return 'role:CODER:code-task';
  return `role:${role}:mission:${kind}`;
}

function isEmbeddingModel(name: string): boolean {
  return /embed/i.test(name);
}

export function installedCompletionModels(installed: ReadonlySet<string>): string[] {
  return [...installed].filter((name) => !isEmbeddingModel(name)).sort();
}

export interface ModelRunPick {
  model: string;
  successes: number;
  attempts: number;
  explored: boolean;
}

/**
 * Choisit un modèle installé selon les vraies réussites/échecs passés sur cette catégorie.
 * Sans historique : le modèle le moins souvent essayé sur la catégorie (exploration), puis ordre stable.
 */
export function pickModelFromRunMemory(
  installed: ReadonlySet<string>,
  category: ModelRunCategory,
  runs: readonly ModelRunRecord[],
): ModelRunPick | null {
  const candidates = installedCompletionModels(installed);
  if (!candidates.length) return null;

  const stats = new Map<string, { ok: number; n: number }>();
  for (const name of candidates) stats.set(name, { ok: 0, n: 0 });
  for (const run of runs) {
    if (run.category !== category || !stats.has(run.model)) continue;
    const row = stats.get(run.model)!;
    row.n += 1;
    if (run.success) row.ok += 1;
  }

  const scored = candidates
    .map((model) => {
      const { ok, n } = stats.get(model)!;
      return { model, ok, n, rate: n ? ok / n : -1 };
    })
    .sort((a, b) => {
      if (a.rate !== b.rate) return b.rate - a.rate;
      if (a.n !== b.n) return b.n - a.n;
      return a.model.localeCompare(b.model);
    });

  const measured = scored.filter((s) => s.n > 0);
  if (measured.length) {
    const best = measured[0]!;
    return {
      model: best.model,
      successes: best.ok,
      attempts: best.n,
      explored: false,
    };
  }

  const explored = candidates
    .map((model) => ({ model, tries: runs.filter((r) => r.category === category && r.model === model).length }))
    .sort((a, b) => a.tries - b.tries || a.model.localeCompare(b.model));
  const pick = explored[0]!;
  return { model: pick.model, successes: 0, attempts: pick.tries, explored: true };
}

export function appendModelRun(
  runs: readonly ModelRunRecord[],
  record: Omit<ModelRunRecord, 'at'> & { at?: number },
): ModelRunRecord[] {
  const next = [...runs, { ...record, at: record.at ?? Date.now() }];
  return next.length > MAX_RUNS ? next.slice(next.length - MAX_RUNS) : next;
}

export function formatRunMemoryLogLine(
  roleLabel: string,
  category: ModelRunCategory,
  pick: ModelRunPick,
): string {
  if (pick.explored) {
    return `${roleLabel} : « ${pick.model} » (aucun historique sur ${category} ; exploration, ${pick.attempts} essai(s) déjà enregistré(s)).`;
  }
  return `${roleLabel} : « ${pick.model} » (${pick.successes}/${pick.attempts} réussites mesurées sur ${category}).`;
}
