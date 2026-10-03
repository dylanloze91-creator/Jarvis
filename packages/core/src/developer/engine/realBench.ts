import type { BenchMetrics } from '../benchmarkTypes.js';
import type { ReviewReport } from '../codeSchemas.js';
import type { CheckedAnswer } from './ask.js';
import { SPECIALIST_ROLES, type SpecialistRole } from './roles.js';

/**
 * Banc réel : des tâches tirées du vrai code de Jarvis (la copie de travail
 * de l'utilisateur, lue sans être modifiée ; les modifications se font dans
 * un dossier jetable). Chaque réussite est vérifiée par du code : fichier
 * cité relu, valeur attendue, compilation et script de contrôle. Le banc ne
 * choisit aucun modèle : il donne un score par rôle.
 */
interface BaseTask {
  id: string;
  label: string;
  roles: readonly SpecialistRole[];
}

/** Fait qui doit être vrai dans la copie pour que la tâche soit mesurable. */
export interface Truth {
  path: string;
  contains: string;
}

export interface AskTask extends BaseTask {
  kind: 'ask';
  question: string;
  truth: Truth;
  /** Un de ces fichiers doit être cité ou nommé. */
  expectFiles: string[];
  /** Tous ces motifs doivent apparaître dans la réponse. */
  expectTerms: RegExp[];
}

export interface PlanTask extends BaseTask {
  kind: 'plan';
  request: string;
  truth: Truth;
  expectFiles: string[];
}

export interface ReviewTask extends BaseTask {
  kind: 'review';
  source: string;
  /** Version modifiée du fichier, ou null si le motif attendu n'y est plus. */
  mutate: (text: string) => string | null;
  expectBlocking: boolean;
}

export interface EditTask extends BaseTask {
  kind: 'edit';
  source: string;
  mutate?: (text: string) => string | null;
  prompt: (checkOutput: string) => string;
  /** Script Node lancé après compilation (`node check.mjs`) : code de sortie 0 = réussi. */
  check: string;
}

export interface CompleteTask extends BaseTask {
  kind: 'complete';
  sources: string[];
  truth: Truth;
  prompt: (texts: Record<string, string>) => string | null;
  accept: (answer: string) => boolean;
}

export type RealBenchTask = AskTask | PlanTask | ReviewTask | EditTask | CompleteTask;

/** Fichier copié dans le dossier jetable des tâches de modification. */
export const EDIT_FIXTURE_SOURCE = 'packages/core/src/developer/repoCheck.ts';
export const EDIT_FIXTURE_PATH = 'src/repoCheck.ts';

export const EDIT_FIXTURE_FILES: Record<string, string> = {
  'package.json': '{ "type": "module", "private": true }\n',
  'tsconfig.json': `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ES2022',
        moduleResolution: 'Bundler',
        outDir: 'out',
        skipLibCheck: true,
        types: [],
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`,
};

const COMPARE_LINE = 'if (diff !== 0) return diff < 0 ? -1 : 1;';

function replaceOnce(text: string, search: string, replace: string): string | null {
  return text.includes(search) ? text.replace(search, replace) : null;
}

function removeFirstLine(text: string, pattern: RegExp): string | null {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) return null;
  lines.splice(index, 1);
  return lines.join('\n');
}

function insertBeforeFirst(text: string, pattern: RegExp, line: string): string | null {
  const lines = text.split('\n');
  const index = lines.findIndex((l) => pattern.test(l));
  if (index < 0) return null;
  lines.splice(index, 0, line);
  return lines.join('\n');
}

function extractFunction(text: string, name: string): string | null {
  const start = text.indexOf(`export function ${name}`);
  if (start < 0) return null;
  const end = text.indexOf('\n}\n', start);
  return end < 0 ? null : text.slice(start, end + 2);
}

const CONTEXT_SOURCES = [
  'packages/core/src/developer/repoCheck.ts',
  'packages/core/src/developer/taskPolicy.ts',
  'packages/core/src/developer/taskPlan.ts',
  'packages/core/src/developer/coreFiles.ts',
  'apps/desktop/src/main/developer/task/sandbox.ts',
  'packages/core/src/developer/toolLoop.ts',
  'packages/core/src/developer/codeSchemas.ts',
  'apps/desktop/src/main/developer/runner.ts',
];

function section(text: string, start: string): string | null {
  const line = text.split('\n').find((l) => l.startsWith(start));
  return line ?? null;
}

export const REAL_BENCH_TASKS: RealBenchTask[] = [
  {
    id: 'ask-tools',
    label: 'Question : où sont enregistrés les outils du chat',
    kind: 'ask',
    roles: ['REASONER'],
    question: 'Dans quel fichier sont enregistrés les outils proposés au modèle du chat ?',
    truth: {
      path: 'apps/desktop/src/main/tools/index.ts',
      contains: 'export function createToolManager',
    },
    expectFiles: ['apps/desktop/src/main/tools/index.ts'],
    expectTerms: [/tools\/index\.ts/],
  },
  {
    id: 'ask-rounds',
    label: 'Question : plafond de tours de l’agent',
    kind: 'ask',
    roles: ['REASONER'],
    question:
      'Combien de tours d’outils au plus l’agent du chat enchaîne-t-il, et où est-ce défini ?',
    truth: { path: 'packages/core/src/agent/agent.ts', contains: 'HARD_TOOL_ROUND_CAP = 6' },
    expectFiles: ['packages/core/src/agent/agent.ts'],
    expectTerms: [/\b6\b/],
  },
  {
    id: 'ask-frozen',
    label: 'Question : test qui fige la requête du chat vers Ollama',
    kind: 'ask',
    roles: ['REASONER'],
    question: 'Quel test fige le corps des requêtes du chat envoyées à Ollama ?',
    truth: { path: 'packages/core/src/providers/ollama-unchanged.test.ts', contains: 'describe(' },
    expectFiles: ['packages/core/src/providers/ollama-unchanged.test.ts'],
    expectTerms: [/ollama-unchanged/],
  },
  {
    id: 'arch-core',
    label: 'Architecture : le paquet qui n’importe jamais Electron',
    kind: 'ask',
    roles: ['ARCHITECT'],
    question: 'Quel paquet du dépôt ne doit jamais importer Electron, et pourquoi ?',
    truth: { path: 'CLAUDE.md', contains: 'n’importe pas Electron' },
    expectFiles: ['CLAUDE.md', 'packages/core/package.json'],
    expectTerms: [/packages\/core|@jarvis\/core/],
  },
  {
    id: 'plan-setting',
    label: 'Plan : ajouter un réglage',
    kind: 'plan',
    roles: ['ARCHITECT', 'CODER'],
    request: 'Ajoute un réglage developer.exemple (booléen, faux par défaut), sans interface.',
    truth: { path: 'packages/core/src/settings.ts', contains: 'developerSettingsSchema' },
    expectFiles: ['packages/core/src/settings.ts'],
  },
  {
    id: 'review-trap',
    label: 'Revue : confirmation retirée de run_command',
    kind: 'review',
    roles: ['REVIEWER'],
    source: 'apps/desktop/src/main/tools/shell.ts',
    mutate: (text) => removeFirstLine(text, /^\s*forceConfirm:\s*true,?\s*$/),
    expectBlocking: true,
  },
  {
    id: 'review-clean',
    label: 'Revue : diff sans risque (fausse alerte ?)',
    kind: 'review',
    roles: ['REVIEWER'],
    source: 'apps/desktop/src/main/tools/shell.ts',
    mutate: (text) =>
      insertBeforeFirst(
        text,
        /^export /,
        '// La commande exacte est montrée telle quelle dans la carte.',
      ),
    expectBlocking: false,
  },
  {
    id: 'fix-mutation',
    label: 'Correction : comparaison de versions inversée',
    kind: 'edit',
    roles: ['DEBUGGER', 'CODER'],
    source: EDIT_FIXTURE_SOURCE,
    mutate: (text) => replaceOnce(text, COMPARE_LINE, 'if (diff !== 0) return diff < 0 ? 1 : -1;'),
    prompt: (output) =>
      `La vérification échoue :\n${output}\nCorrige ${EDIT_FIXTURE_PATH} avec les outils, sans désactiver la vérification.`,
    check: `import { compareVersions } from './out/repoCheck.js';
const cases = [['0.4.25', '0.4.26', -1], ['0.5.0', '0.4.26', 1], ['v1.2.3', '1.2.3', 0], ['1.10.0', '1.9.9', 1]];
let bad = 0;
for (const [a, b, want] of cases) {
  const got = compareVersions(a, b);
  if (got !== want) { console.log('compareVersions("' + a + '", "' + b + '") = ' + got + ', attendu ' + want); bad += 1; }
}
process.exit(bad ? 1 : 0);
`,
  },
  {
    id: 'gen-function',
    label: 'Génération : nouvelle fonction dans un vrai fichier',
    kind: 'edit',
    roles: ['CODER'],
    source: EDIT_FIXTURE_SOURCE,
    prompt: () =>
      `Ajoute à ${EDIT_FIXTURE_PATH} une fonction exportée isSameRemote(a: string, b: string): boolean qui renvoie vrai quand normalizeRemote(a) et normalizeRemote(b) sont égaux. Ne change rien d'autre.`,
    check: `import { isSameRemote } from './out/repoCheck.js';
const ok = typeof isSameRemote === 'function'
  && isSameRemote('https://github.com/a/b.git', 'git@github.com:a/b') === true
  && isSameRemote('https://github.com/a/b.git', 'https://github.com/a/c.git') === false;
if (!ok) console.log('isSameRemote absente ou fausse');
process.exit(ok ? 0 : 1);
`,
  },
  {
    id: 'context-needle',
    label: 'Contexte long : une valeur au milieu de 8 fichiers',
    kind: 'complete',
    roles: ['REASONER', 'ARCHITECT'],
    sources: CONTEXT_SOURCES,
    truth: {
      path: 'apps/desktop/src/main/developer/task/sandbox.ts',
      contains: 'SANDBOX_MIN_FREE_BYTES = 3e9',
    },
    prompt: (texts) => {
      const blocks = CONTEXT_SOURCES.map((path) =>
        texts[path] === undefined ? null : `--- ${path}\n${texts[path]}`,
      );
      if (blocks.some((b) => b === null)) return null;
      return `${blocks.join('\n\n')}\n\nQuestion : quelle est la valeur de SANDBOX_MIN_FREE_BYTES ? Réponds en une phrase.`;
    },
    accept: (answer) => /3e9|3\s*000\s*000\s*000|\b3\s*Go\b|3\s*×\s*10/i.test(answer),
  },
  {
    id: 'doc-explain',
    label: 'Documentation : expliquer une fonction en français',
    kind: 'complete',
    roles: ['DOCUMENTATION'],
    sources: [EDIT_FIXTURE_SOURCE],
    truth: { path: EDIT_FIXTURE_SOURCE, contains: 'export function compareVersions' },
    prompt: (texts) => {
      const fn = extractFunction(texts[EDIT_FIXTURE_SOURCE] ?? '', 'compareVersions');
      return fn
        ? `Voici une fonction TypeScript :\n${fn}\nExplique en français, en trois phrases au plus, ce qu'elle fait et ce qu'elle renvoie.`
        : null;
    },
    accept: (answer) => {
      const words = [' la ', ' le ', ' les ', ' des ', ' une ', ' est ', ' deux '];
      const french = words.filter((w) => ` ${answer.toLowerCase()} `.includes(w)).length >= 2;
      return /version/i.test(answer) && french && answer.length >= 40 && answer.length <= 1_500;
    },
  },
  {
    id: 'test-write',
    label: 'Tests : écrire un test Vitest',
    kind: 'complete',
    roles: ['TESTER'],
    sources: [EDIT_FIXTURE_SOURCE],
    truth: { path: EDIT_FIXTURE_SOURCE, contains: 'export function compareVersions' },
    prompt: (texts) => {
      const fn = extractFunction(texts[EDIT_FIXTURE_SOURCE] ?? '', 'compareVersions');
      return fn
        ? `Voici une fonction TypeScript :\n${fn}\nÉcris un test Vitest (describe, it, expect) avec au moins trois cas. Réponds seulement par le code.`
        : null;
    },
    accept: (answer) =>
      /describe\s*\(/.test(answer) &&
      /\b(it|test)\s*\(/.test(answer) &&
      (answer.match(/expect\s*\(/g) ?? []).length >= 3 &&
      /compareVersions/.test(answer),
  },
  {
    id: 'research-pages',
    label: 'Recherche : répondre depuis des pages données, avec la source',
    kind: 'complete',
    roles: ['RESEARCHER'],
    sources: ['CLAUDE.md'],
    truth: { path: 'CLAUDE.md', contains: "searchProvider: 'google'" },
    prompt: (texts) => {
      const text = texts['CLAUDE.md'] ?? '';
      const spotify = section(text, '**Spotify**');
      const search = section(text, '**Recherche web sans clé**');
      return spotify && search
        ? `Page 1 :\n${spotify}\n\nPage 2 :\n${search}\n\nQuestion : quel fournisseur de recherche Jarvis utilise-t-il par défaut, sans clé ? Réponds en une phrase et cite la page utilisée (« Page 1 » ou « Page 2 »).`
        : null;
    },
    accept: (answer) => /google/i.test(answer) && /page\s*2/i.test(answer),
  },
];

/** Diff unifié minimal (un seul bloc) entre deux versions d'un fichier, pour la revue. */
export function singleHunkDiff(path: string, before: string, after: string, context = 3): string {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const from = Math.max(0, start - context);
  const toA = Math.min(a.length, endA + context);
  const toB = Math.min(b.length, endB + context);
  const lines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${from + 1},${toA - from} +${from + 1},${toB - from} @@`,
    ...a.slice(from, start).map((l) => ` ${l}`),
    ...a.slice(start, endA).map((l) => `-${l}`),
    ...b.slice(start, endB).map((l) => `+${l}`),
    ...a.slice(endA, toA).map((l) => ` ${l}`),
  ];
  return `${lines.join('\n')}\n`;
}

export const REVIEW_RULES = [
  'Une confirmation retirée ou affaiblie (forceConfirm, risk « confirm ») est bloquante.',
  'Un secret en clair, une dépendance ajoutée ou un fichier du cœur touché se signalent.',
  'Un commentaire seul n’est pas un risque.',
];

export function judgeAsk(task: AskTask, checked: CheckedAnswer): { ok: boolean; detail: string } {
  const haystack = [
    checked.answer,
    ...checked.files.map((f) => f.path),
    ...checked.citations.map((c) => c.path),
  ].join('\n');
  const terms = task.expectTerms.every((term) => term.test(haystack));
  const file = task.expectFiles.some((f) => haystack.includes(f));
  const proved = checked.verified > 0;
  if (terms && file && proved)
    return { ok: true, detail: `réponse juste, ${checked.verified} citation(s) vérifiée(s)` };
  const missing = [
    terms ? null : 'valeur attendue absente',
    file ? null : `fichier attendu non cité (${task.expectFiles[0]})`,
    proved ? null : 'aucune citation vérifiée dans le fichier',
  ].filter(Boolean);
  return { ok: false, detail: missing.join(' ; ') };
}

export function judgeReview(
  task: ReviewTask,
  report: ReviewReport,
): { ok: boolean; detail: string } {
  const blocking = report.findings.some((f) => f.severity === 'bloquant');
  if (task.expectBlocking)
    return blocking && report.verdict !== 'ok'
      ? { ok: true, detail: 'confirmation retirée signalée comme bloquante' }
      : { ok: false, detail: `piège non vu (verdict « ${report.verdict} »)` };
  return !blocking && report.verdict !== 'refusé'
    ? { ok: true, detail: 'aucune fausse alerte' }
    : { ok: false, detail: 'fausse alerte bloquante sur un commentaire' };
}

export interface RealBenchTaskResult {
  id: string;
  label: string;
  roles: SpecialistRole[];
  /** null : non mesurable (fait de référence absent de la copie, ou outil manquant). */
  ok: boolean | null;
  detail: string;
  durationMs: number;
  outputTokPerSec: number | null;
  calls: number;
}

export interface RoleScore {
  role: SpecialistRole;
  passed: number;
  measured: number;
  total: number;
  /** passed / measured, null si rien n'a pu être mesuré. */
  score: number | null;
}

export interface RealBenchResult {
  model: string;
  startedAt: number;
  finishedAt: number;
  /** Commit de la copie de travail lue. */
  commit: string | null;
  tasks: RealBenchTaskResult[];
  roles: RoleScore[];
  metrics: BenchMetrics;
}

export function scoreRoles(tasks: RealBenchTaskResult[]): RoleScore[] {
  return SPECIALIST_ROLES.map((role) => {
    const mine = tasks.filter((task) => task.roles.includes(role));
    const measured = mine.filter((task) => task.ok !== null);
    const passed = measured.filter((task) => task.ok).length;
    return {
      role,
      passed,
      measured: measured.length,
      total: mine.length,
      score: measured.length ? Math.round((passed / measured.length) * 100) / 100 : null,
    };
  });
}

export function realBenchTask(id: string): RealBenchTask | undefined {
  return REAL_BENCH_TASKS.find((task) => task.id === id);
}
