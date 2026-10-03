import { z } from 'zod';
import { profileSuiteCommand, type ProjectTestSuite } from './engine/projectProfile.js';

/** Liste fixe des tests (décision 9) : automatiques seulement dans la copie isolée. */
export const TEST_SUITES = {
  typecheck: { label: 'Vérification des types', npmArgs: ['run', 'typecheck'] },
  'test-core': { label: 'Tests du cœur', npmArgs: ['run', 'test', '--workspace', '@jarvis/core'] },
  'test-desktop': {
    label: 'Tests de l’application',
    npmArgs: ['run', 'test', '--workspace', '@jarvis/desktop'],
  },
  test: { label: 'Tous les tests', npmArgs: ['test'] },
  lint: { label: 'Lint', npmArgs: ['run', 'lint'] },
} as const;

export type TestSuiteId = keyof typeof TEST_SUITES;
export const TEST_SUITE_IDS = Object.keys(TEST_SUITES) as TestSuiteId[];
export const DEFAULT_TEST_SUITES: TestSuiteId[] = ['typecheck', 'test-core'];
export const MAX_FIX_ATTEMPTS = 3;
/** Bornes du réglage `developer.maxFixAttempts`. */
export const FIX_ATTEMPTS_MIN = 1;
export const FIX_ATTEMPTS_MAX = 5;
/** Référence + premier essai + une série par correction (décision 9 : maxFixAttempts + 2). */
export const MAX_TEST_SERIES = MAX_FIX_ATTEMPTS + 2;

export function maxTestSeriesFor(maxFixAttempts: number): number {
  return maxFixAttempts + 2;
}

/** Réglage absent ou hors bornes : `MAX_FIX_ATTEMPTS`. */
export function resolveMaxFixAttempts(value: number | undefined): number {
  return value !== undefined &&
    Number.isInteger(value) &&
    value >= FIX_ATTEMPTS_MIN &&
    value <= FIX_ATTEMPTS_MAX
    ? value
    : MAX_FIX_ATTEMPTS;
}

export function suiteCommand(suite: TestSuiteId): string {
  return `npm ${TEST_SUITES[suite].npmArgs.join(' ')}`;
}

/** Commande d'un test pour un projet : celle de son profil s'il la définit, sinon la liste fixe npm. */
export function suiteCommandFor(
  profile: { testSuites: Readonly<Record<string, ProjectTestSuite>> },
  suite: TestSuiteId,
): string {
  const own = profile.testSuites[suite];
  return own ? profileSuiteCommand(own) : suiteCommand(suite);
}

export type PlanAction = 'create' | 'edit' | 'delete';

export interface TaskPlan {
  summary: string;
  criteria: string[];
  files: Array<{ path: string; action: PlanAction; reason: string }>;
  tests: TestSuiteId[];
}

const ACTIONS: Record<string, PlanAction> = {
  create: 'create',
  creer: 'create',
  créer: 'create',
  ajouter: 'create',
  new: 'create',
  edit: 'edit',
  modify: 'edit',
  modifier: 'edit',
  update: 'edit',
  delete: 'delete',
  supprimer: 'delete',
  remove: 'delete',
};

const fileSchema = z
  .object({
    chemin: z.string().optional(),
    path: z.string().optional(),
    action: z.string().optional(),
    pourquoi: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

/** Le modèle peut répondre en français ou en anglais : les deux formes sont acceptées. */
export const rawPlanSchema = z
  .object({
    resume: z.string().optional(),
    résumé: z.string().optional(),
    summary: z.string().optional(),
    criteres: z.array(z.string()).optional(),
    critères: z.array(z.string()).optional(),
    criteria: z.array(z.string()).optional(),
    fichiers: z.array(fileSchema).optional(),
    files: z.array(fileSchema).optional(),
    tests: z.array(z.string()).optional(),
  })
  .passthrough()
  .refine((value) => (value.fichiers ?? value.files ?? []).length > 0, {
    message: 'le plan doit lister au moins un fichier (« fichiers »)',
  });

/** Tests d'un projet : sous-ensemble de la liste fixe, et ceux lancés quand le plan n'en cite aucun. */
export interface SuiteSet {
  ids: readonly TestSuiteId[];
  defaults: readonly TestSuiteId[];
}

export const JARVIS_SUITES: SuiteSet = { ids: TEST_SUITE_IDS, defaults: DEFAULT_TEST_SUITES };

/** Tests d'un profil de projet, dans l'ordre de la liste fixe. */
export function suiteSetOf(profile: {
  testSuites: Readonly<Record<string, unknown>>;
  defaultTestSuites: readonly string[];
}): SuiteSet {
  const ids = TEST_SUITE_IDS.filter((id) => id in profile.testSuites);
  return { ids, defaults: ids.filter((id) => profile.defaultTestSuites.includes(id)) };
}

export function normalizePlan(
  raw: z.infer<typeof rawPlanSchema>,
  suites: SuiteSet = JARVIS_SUITES,
): TaskPlan {
  const files = (raw.fichiers ?? raw.files ?? []).map((file) => ({
    path: (file.chemin ?? file.path ?? '').trim(),
    action: ACTIONS[(file.action ?? 'edit').trim().toLowerCase()] ?? 'edit',
    reason: (file.pourquoi ?? file.reason ?? '').trim().slice(0, 300),
  }));
  const tests = (raw.tests ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is TestSuiteId => (suites.ids as string[]).includes(value));
  return {
    summary: (raw.resume ?? raw.résumé ?? raw.summary ?? '').trim().slice(0, 600),
    criteria: (raw.criteres ?? raw.critères ?? raw.criteria ?? [])
      .map((c) => c.slice(0, 200))
      .slice(0, 8),
    files: files.filter((file) => file.path).slice(0, 30),
    tests: orderSuites(tests.length ? tests : [...suites.defaults], suites.ids),
  };
}

/**
 * La vérification des types passe toujours en premier : elle compile le cœur,
 * dont les tests de l'application ont besoin. « test » couvre les deux espaces.
 */
export function orderSuites(
  suites: TestSuiteId[],
  ids: readonly TestSuiteId[] = TEST_SUITE_IDS,
): TestSuiteId[] {
  const set = new Set<TestSuiteId>([
    ...(ids.includes('typecheck') ? (['typecheck'] as const) : []),
    ...suites,
  ]);
  if (set.has('test')) {
    set.delete('test-core');
    set.delete('test-desktop');
  }
  return ids.filter((id) => set.has(id));
}
