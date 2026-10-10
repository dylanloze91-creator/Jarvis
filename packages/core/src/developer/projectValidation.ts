import type { TestSuiteId } from './taskPlan.js';
import { orderSuites } from './taskPlan.js';

/** Rôles reconnus dans package.json (clé exacte, pas d’invention de `npm test`). */
export type NpmValidationKind = 'typecheck' | 'test' | 'lint' | 'build';

export const NPM_VALIDATION_KINDS: readonly NpmValidationKind[] = [
  'typecheck',
  'test',
  'lint',
  'build',
];

export function npmScriptPresent(
  scripts: Readonly<Record<string, string>>,
  kind: NpmValidationKind,
): boolean {
  const value = scripts[kind];
  return typeof value === 'string' && value.trim() !== '';
}

/** Scripts npm réellement présents, dans l’ordre d’exécution (le plus ciblé d’abord). */
export function detectNpmValidationKinds(
  scripts: Readonly<Record<string, string>>,
): NpmValidationKind[] {
  return NPM_VALIDATION_KINDS.filter((kind) => npmScriptPresent(scripts, kind));
}

export function npmValidationCommand(kind: NpmValidationKind): string {
  return kind === 'test' ? 'npm test' : `npm run ${kind}`;
}

/**
 * Commandes affichées dans l’inventaire : scripts standard puis autres scripts
 * liés aux vérifications (sans inventer `npm test` si la clé « test » est absente).
 */
export function npmValidationCommands(scripts: Readonly<Record<string, string>>): string[] {
  const preferred = detectNpmValidationKinds(scripts).map(npmValidationCommand);
  const seen = new Set(preferred);
  const extra: string[] = [];
  for (const key of Object.keys(scripts)) {
    if (NPM_VALIDATION_KINDS.includes(key as NpmValidationKind)) continue;
    if (/test|lint|type|check|build/i.test(key)) {
      const cmd = `npm run ${key}`;
      if (!seen.has(cmd)) {
        seen.add(cmd);
        extra.push(cmd);
      }
    }
  }
  return [...preferred, ...extra].slice(0, 8);
}

export function hasNpmTestScript(scripts: Readonly<Record<string, string>>): boolean {
  return npmScriptPresent(scripts, 'test');
}

/** Suites de tâche Node dérivées des scripts réels (pas de `build` dans la boucle de tests). */
export const NODE_TASK_SUITE_KINDS = ['typecheck', 'test', 'lint'] as const satisfies readonly NpmValidationKind[];

export function nodeTaskSuiteIds(scripts: Readonly<Record<string, string>>): TestSuiteId[] {
  return NODE_TASK_SUITE_KINDS.filter((kind) => npmScriptPresent(scripts, kind)) as TestSuiteId[];
}

/** Suites par défaut d’un plan de secours ou d’un projet Node (ordre ciblé → large). */
export function defaultNodePlanSuites(scripts: Readonly<Record<string, string>>): TestSuiteId[] {
  const ids = nodeTaskSuiteIds(scripts);
  const defaults = ids.filter((id) => id !== 'lint');
  return orderSuites(defaults.length ? defaults : ids, ids);
}

/** Critères d’acceptation alignés sur ce qui peut réellement être lancé. */
export function verificationCriteriaFromScripts(
  scripts: Readonly<Record<string, string>>,
): string[] {
  const criteria: string[] = [];
  if (npmScriptPresent(scripts, 'typecheck')) criteria.push('la vérification des types passe');
  if (hasNpmTestScript(scripts)) criteria.push('les tests passent');
  else if (npmScriptPresent(scripts, 'build'))
    criteria.push('la compilation (build) passe');
  if (!criteria.length && npmScriptPresent(scripts, 'lint')) criteria.push('le lint passe');
  return criteria;
}

export function suiteExpectsTestCounts(suite: string): boolean {
  return suite === 'test' || suite === 'test-core' || suite === 'test-desktop';
}

/**
 * Résumé lisible après une série de vérifications : sans script « test », on ne
 * prétend pas que des tests unitaires sont passés.
 */
export function profileHasUnitTestSuite(profile: {
  testSuites: Readonly<Record<string, unknown>>;
}): boolean {
  return ['test', 'test-core', 'test-desktop'].some((id) => id in profile.testSuites);
}

export function formatTaskVerificationSummary(
  parts: ReadonlyArray<{ suite: string; summary: string }>,
  options: {
    scripts?: Readonly<Record<string, string>>;
    profile?: { testSuites: Readonly<Record<string, unknown>> };
  } = {},
): string {
  const line = parts.map((p) => `${p.suite} : ${p.summary}`).join(' · ');
  const hasTest =
    (options.scripts ? hasNpmTestScript(options.scripts) : false) ||
    (options.profile ? profileHasUnitTestSuite(options.profile) : false) ||
    parts.some((p) => suiteExpectsTestCounts(p.suite));
  if (hasTest || !parts.length) return line;
  return `${line} (aucun script « test » : vérifications sans suite de tests unitaires)`;
}
