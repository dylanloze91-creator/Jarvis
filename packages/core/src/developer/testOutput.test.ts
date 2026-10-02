import { describe, expect, it } from 'vitest';
import { compareRuns, parseTestOutput, testExcerpt, type TestRunSummary } from './testOutput.js';
import { parseUnifiedDiff, trimDiffFiles } from './unifiedDiff.js';

const run = (suite: string, failures: string[], timedOut = false): TestRunSummary => ({
  suite,
  command: suite,
  exitCode: failures.length ? 1 : 0,
  failures,
  summary: '',
  excerpt: '',
  durationMs: 1,
  timedOut,
});

describe('lecture des sorties de tests', () => {
  it('tsc : erreurs avec fichier relatif au dossier de la tâche', () => {
    const out = [
      "C:\\dev\\Jarvis-taches\\t1\\packages\\core\\src\\x.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/y.ts(10,1): error TS2304: Cannot find name 'foo'.",
    ].join('\n');
    const parsed = parseTestOutput(out, { exitCode: 2, root: 'C:\\dev\\Jarvis-taches\\t1' });
    expect(parsed.failures).toEqual([
      "tsc packages/core/src/x.ts TS2322 Type 'string' is not assignable to type 'number'.",
      "tsc src/y.ts TS2304 Cannot find name 'foo'.",
    ]);
    expect(parsed.summary).toBe('2 erreur(s) TypeScript');
  });

  it('Vitest : tests échoués et total, couleurs retirées', () => {
    const out = [
      '\u001b[31m FAIL \u001b[39m src/a.test.ts > outils > donne la version',
      ' FAIL  src/b.test.ts > b > marche',
      '      Tests  2 failed | 89 passed (91)',
    ].join('\n');
    const parsed = parseTestOutput(out, { exitCode: 1 });
    expect(parsed.failures).toEqual([
      'test src/a.test.ts > outils > donne la version',
      'test src/b.test.ts > b > marche',
    ]);
    expect(parsed.summary).toBe('2 test(s) échoué(s) sur 91');
  });

  it('Vitest réussi', () => {
    expect(parseTestOutput('      Tests  1463 passed (1463)', { exitCode: 0 })).toEqual({
      failures: [],
      summary: '1463 tests réussis',
    });
  });

  it('ESLint : erreurs par fichier', () => {
    const out = [
      '/tmp/t/src/a.ts',
      "  3:7  error  'x' is assigned a value but never used  @typescript-eslint/no-unused-vars",
      '',
      '✖ 1 problem (1 error, 0 warnings)',
    ].join('\n');
    const parsed = parseTestOutput(out, { exitCode: 1, root: '/tmp/t' });
    expect(parsed.failures).toEqual([
      "lint src/a.ts @typescript-eslint/no-unused-vars 'x' is assigned a value but never used",
    ]);
  });

  it('un échec sans détail lisible reste un échec', () => {
    expect(parseTestOutput('npm ERR! missing script', { exitCode: 1 })).toEqual({
      failures: ['sortie 1'],
      summary: 'échec (code 1)',
    });
  });

  it('extrait : erreurs d’abord, puis la fin', () => {
    const out = [
      'a',
      'src/x.ts(1,1): error TS1: e',
      ...Array.from({ length: 80 }, (_, i) => `l${i}`),
    ].join('\n');
    const excerpt = testExcerpt(out, 10);
    expect(excerpt.split('\n')[0]).toContain('TS1');
    expect(excerpt).toContain('l79');
  });
});

describe('comparaison avec la référence', () => {
  it('un échec déjà présent n’est pas imputé à la tâche', () => {
    const baseline = [run('test-core', ['test a > x'])];
    const current = [run('test-core', ['test a > x', 'test b > y'])];
    expect(compareRuns(baseline, current)).toEqual({
      newFailures: ['test-core: test b > y'],
      fixed: [],
      preexisting: ['test-core: test a > x'],
      ok: false,
    });
  });

  it('réussi si seuls les échecs d’avant restent ; signale ceux qui ont disparu', () => {
    const result = compareRuns([run('typecheck', ['tsc a TS1 e'])], [run('typecheck', [])]);
    expect(result).toMatchObject({ ok: true, fixed: ['typecheck: tsc a TS1 e'] });
  });

  it('un délai dépassé est un échec', () => {
    expect(compareRuns([], [run('test', [], true)]).ok).toBe(false);
  });
});

describe('diff unifié', () => {
  const diff = [
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1,2 @@',
    '+export const a = 1;',
    '+export const b = 2;',
    'diff --git a/src/old.ts b/src/old.ts',
    'index 2222222..3333333 100644',
    '--- a/src/old.ts',
    '+++ b/src/old.ts',
    '@@ -4,3 +4,3 @@ export function f() {',
    ' const x = 1;',
    '-return x;',
    '+return x + 1;',
    '\\ No newline at end of file',
    'diff --git a/src/gone.ts b/src/gone.ts',
    'deleted file mode 100644',
    '--- a/src/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-export {};',
  ].join('\n');

  it('fichiers, statuts, compteurs et numéros de ligne', () => {
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['src/new.ts', 'added', 2, 0],
      ['src/old.ts', 'modified', 1, 1],
      ['src/gone.ts', 'deleted', 0, 1],
    ]);
    expect(files[1]!.hunks[0]!.lines).toEqual([
      { kind: 'context', text: 'const x = 1;', oldLine: 4, newLine: 4 },
      { kind: 'del', text: 'return x;', oldLine: 5, newLine: null },
      { kind: 'add', text: 'return x + 1;', oldLine: null, newLine: 5 },
    ]);
  });

  it('allégé pour l’affichage', () => {
    const trimmed = trimDiffFiles(parseUnifiedDiff(diff), 1);
    expect(trimmed[0]!.hunks[0]!.lines).toHaveLength(1);
    expect(trimmed[0]!.additions).toBe(2);
  });
});
