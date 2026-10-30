import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../developer/unifiedDiff.js';
import {
  applyExperienceToSource,
  applyIncoming,
  experienceAttempt,
  experienceFromMission,
  experienceReplacement,
  formatLearningContext,
  relevantRecords,
  retrieveExperiences,
  type LearningRecord,
} from './continuous.js';

/** `--experimental-strip-types` n'existe qu'à partir de Node 22.6 ; le projet accepte Node 20 (environmentCheck). */
const STRIP_TYPES = (() => {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 6);
})();

function runTest(cwd: string, file: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', file], {
    cwd,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

function projectTest(fn: string, body: string): string {
  return `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { ${fn} } from './${fn}.ts';\n${body}\n`;
}

async function dirs(): Promise<{ root: string; a: string; b: string; empty: string }> {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-fam-'));
  const a = join(root, 'a');
  const b = join(root, 'b');
  const empty = join(root, 'vide');
  await mkdir(a);
  await mkdir(b);
  await mkdir(empty);
  return { root, a, b, empty };
}

function learned(input: {
  id: string;
  request: string;
  error: string;
  before: string;
  after: string;
  commands: string[];
  diff: string;
  version?: string;
}): LearningRecord {
  const replacement = experienceReplacement(parseUnifiedDiff(input.diff));
  const record = experienceFromMission({
    id: input.id,
    now: 42,
    ok: true,
    request: input.request,
    errorSignature: input.error,
    cause: input.error,
    fix: 'Indice local sur ce projet. Ne pas recopier l’ancien fichier.',
    testCommands: input.commands,
    beforeResult: 'rouge',
    afterResult: 'vert',
    files: ['src.ts'],
    ...(replacement ? { hint: replacement } : {}),
    trace: {
      problem: input.request,
      context: 'projet isolé',
      firstTry: input.error,
      observedErrors: input.error,
      appliedFix: 'remplacement local',
      testsRun: input.commands,
      finalResult: 'vert',
      limits: 'même langage, même version',
      language: replacement?.language ?? 'typescript',
      problemType: 'expérience',
      runtimeVersion: input.version ?? process.version,
      outcome: 'passed',
    },
  });
  if (!record) throw new Error(`fiche non validée pour ${input.id}`);
  return record;
}

describe('réutilisation au-delà d’une addition', () => {
  it.skipIf(!STRIP_TYPES)('retrouve une division par une liste vide malgré une autre formulation', async () => {
    const { a, b, empty } = await dirs();
    const before = `export function ratio(items: number[]): number {\n  const sum = items.reduce((x, y) => x + y, 0);\n  return sum / items.length;\n}\n`;
    const after = `export function ratio(items: number[]): number {\n  const sum = items.reduce((x, y) => x + y, 0);\n  return items.length === 0 ? 0 : sum / items.length;\n}\n`;
    const testA = projectTest('ratio', "test('liste vide', () => { assert.equal(ratio([]), 0); });");
    await writeFile(join(a, 'ratio.ts'), before);
    await writeFile(join(a, 'ratio.test.ts'), testA);
    expect(runTest(a, 'ratio.test.ts').status).not.toBe(0);
    await writeFile(join(a, 'ratio.ts'), after);
    expect(runTest(a, 'ratio.test.ts').status).toBe(0);

    const diff = [
      'diff --git a/ratio.ts b/ratio.ts',
      '--- a/ratio.ts',
      '+++ b/ratio.ts',
      '@@ -1,3 +1,3 @@',
      ' export function ratio(items: number[]): number {',
      '   const sum = items.reduce((x, y) => x + y, 0);',
      '-  return sum / items.length;',
      '+  return items.length === 0 ? 0 : sum / items.length;',
      ' }',
      '',
    ].join('\n');
    const requestA = 'La fonction ratio divise une somme par la taille. Une liste vide produit NaN.';
    const requestB = 'La moyenne d une collection sans element ne doit pas devenir une valeur qui n est pas un nombre.';
    expect(requestB).not.toContain('length === 0');
    expect(requestB).not.toContain('NaN');
    const record = learned({
      id: 'vide',
      request: requestA,
      error: 'Expected values to be strictly equal: 0 !== NaN',
      before,
      after,
      commands: ['node --test ratio.test.ts'],
      diff,
    });
    const stored = JSON.parse(JSON.stringify(applyIncoming([], record).records)) as LearningRecord[];
    const found = retrieveExperiences(stored, { query: requestB, language: 'typescript', version: process.version });
    expect(found.applicable.map((item) => item.id)).toEqual(['vide']);
    const mean = before.replaceAll('ratio', 'mean');
    const withMemory = applyExperienceToSource(mean, found.applicable, { language: 'typescript', version: process.version });
    expect(withMemory.applied).toBe(true);
    expect(withMemory.source).toContain('function mean');
    expect(withMemory.source).not.toContain('function ratio');
    await writeFile(join(b, 'mean.ts'), withMemory.source);
    await writeFile(join(b, 'mean.test.ts'), projectTest('mean', "test('collection', () => { assert.equal(mean([]), 0); });"));
    const green = runTest(b, 'mean.test.ts');
    expect(green.status, green.output).toBe(0);
    const untouched = applyExperienceToSource(mean, []);
    await writeFile(join(empty, 'mean.ts'), untouched.source);
    await writeFile(join(empty, 'mean.test.ts'), projectTest('mean', "test('collection', () => { assert.equal(mean([]), 0); });"));
    expect(runTest(empty, 'mean.test.ts').status).not.toBe(0);
  });

  it.skipIf(!STRIP_TYPES)('corrige un mauvais appel et une méthode de texte sans écrire la solution dans la demande', async () => {
    const floorDiff = [
      'diff --git a/hausse.ts b/hausse.ts',
      '--- a/hausse.ts',
      '+++ b/hausse.ts',
      '@@ -1,3 +1,3 @@',
      ' export function hausse(n: number): number {',
      '-  return Math.floor(n);',
      '+  return Math.ceil(n);',
      ' }',
      '',
    ].join('\n');
    const record = learned({
      id: 'ceil',
      request: 'hausse coupe la partie fractionnaire vers le bas. Le controle attend la partie haute.',
      error: 'Expected values to be strictly equal: 2 !== 1',
      before: '',
      after: '',
      commands: ['node --test hausse.test.ts'],
      diff: floorDiff,
    });
    const query = 'plafond laisse la fraction de cote alors que la partie haute est attendue.';
    expect(query).not.toContain('ceil');
    const found = retrieveExperiences([record], { query, language: 'typescript' });
    expect(found.applicable).toHaveLength(1);
    const source = `export function plafond(n: number): number {\n  return Math.floor(n);\n}\n`;
    const applied = applyExperienceToSource(source, found.applicable, { language: 'typescript' });
    expect(applied.source).toContain('return Math.ceil(n);');
    expect(applied.source).toContain('function plafond');
    const { b, empty } = await dirs();
    await writeFile(join(b, 'plafond.ts'), applied.source);
    await writeFile(join(b, 'plafond.test.ts'), projectTest('plafond', "test('haut', () => { assert.equal(plafond(1.2), 2); });"));
    expect(runTest(b, 'plafond.test.ts').status).toBe(0);
    await writeFile(join(empty, 'plafond.ts'), source);
    await writeFile(join(empty, 'plafond.test.ts'), projectTest('plafond', "test('haut', () => { assert.equal(plafond(1.2), 2); });"));
    expect(runTest(empty, 'plafond.test.ts').status).not.toBe(0);

    const trimDiff = [
      'diff --git a/label.ts b/label.ts',
      '--- a/label.ts',
      '+++ b/label.ts',
      '@@ -1,3 +1,3 @@',
      ' export function label(value: number): string {',
      '-  return value.trim();',
      '+  return String(value).trim();',
      ' }',
      '',
    ].join('\n');
    const trim = learned({
      id: 'trim',
      request: 'label appelle une methode de texte sur un nombre.',
      error: 'TypeError: value.trim is not a function',
      before: '',
      after: '',
      commands: ['node --test label.test.ts'],
      diff: trimDiff,
    });
    const tagQuery = 'tag recoit un nombre et plante en cherchant une methode de chaine.';
    expect(tagQuery).not.toContain('String(');
    const tags = retrieveExperiences([trim], { query: tagQuery, language: 'typescript' });
    const tag = applyExperienceToSource(
      `export function tag(value: number): string {\n  return value.trim();\n}\n`,
      tags.applicable,
      { language: 'typescript' },
    );
    expect(tag.source).toContain('String(value).trim()');
    const { a } = await dirs();
    await writeFile(join(a, 'tag.ts'), tag.source);
    await writeFile(join(a, 'tag.test.ts'), projectTest('tag', "test('nombre', () => { assert.equal(tag(12), '12'); });"));
    expect(runTest(a, 'tag.test.ts').status).toBe(0);
  });

  it.skipIf(!STRIP_TYPES)('reporte un index de fin sur un autre nom, et un bloc quand le texte explose', async () => {
    const diff = [
      'diff --git a/last.ts b/last.ts',
      '--- a/last.ts',
      '+++ b/last.ts',
      '@@ -1,3 +1,3 @@',
      ' export function last(items: number[]): number | undefined {',
      '-  return items[items.length];',
      '+  return items[items.length - 1];',
      ' }',
      '',
    ].join('\n');
    const record = learned({
      id: 'fin',
      request: 'last lit apres le dernier element.',
      error: 'Expected values to be strictly equal: 3 !== undefined',
      before: '',
      after: '',
      commands: ['node --test last.test.ts'],
      diff,
    });
    const query = 'end depasse la fin du tableau.';
    expect(query).not.toContain('length - 1');
    const found = retrieveExperiences([record], { query, language: 'typescript' });
    expect(found.applicable).toHaveLength(1);
    const rows = `export function end(rows: number[]): number | undefined {\n  return rows[rows.length];\n}\n`;
    const applied = applyExperienceToSource(rows, found.applicable, { language: 'typescript' });
    expect(applied.applied).toBe(true);
    expect(applied.source).toContain('return rows[rows.length - 1];');
    expect(applied.source).not.toContain('function last');
    const { b, empty } = await dirs();
    await writeFile(join(b, 'end.ts'), applied.source);
    await writeFile(join(b, 'end.test.ts'), projectTest('end', "test('fin', () => { assert.equal(end([4, 5, 6]), 6); });"));
    expect(runTest(b, 'end.test.ts').status).toBe(0);
    await writeFile(join(empty, 'end.ts'), rows);
    await writeFile(join(empty, 'end.test.ts'), projectTest('end', "test('fin', () => { assert.equal(end([4, 5, 6]), 6); });"));
    expect(runTest(empty, 'end.test.ts').status).not.toBe(0);

    const block = [
      'diff --git a/read.ts b/read.ts',
      '--- a/read.ts',
      '+++ b/read.ts',
      '@@ -1,3 +1,7 @@',
      ' export function read(text: string): unknown {',
      '-  return JSON.parse(text);',
      '+  try {',
      '+    return JSON.parse(text);',
      '+  } catch {',
      '+    return null;',
      '+  }',
      ' }',
      '',
    ].join('\n');
    const parsed = learned({
      id: 'json',
      request: 'read explose sur un texte qui n est pas du JSON.',
      error: 'SyntaxError: Unexpected token',
      before: '',
      after: '',
      commands: ['node --test read.test.ts'],
      diff: block,
    });
    const loadQuery = 'load explose sur un texte inutilisable.';
    expect(loadQuery).not.toContain('catch');
    const loads = retrieveExperiences([parsed], { query: loadQuery, language: 'typescript' });
    const load = applyExperienceToSource(
      `export function load(text: string): unknown {\n  return JSON.parse(text);\n}\n`,
      loads.applicable,
      { language: 'typescript' },
    );
    expect(load.applied).toBe(true);
    expect(load.source).toContain('catch');
    expect(load.source).toContain('function load');
    const { root } = await dirs();
    const dir = join(root, 'json');
    await mkdir(dir);
    await writeFile(join(dir, 'load.ts'), load.source);
    await writeFile(join(dir, 'load.test.ts'), projectTest('load', "test('invalide', () => { assert.equal(load('nope'), null); });"));
    expect(runTest(dir, 'load.test.ts').status).toBe(0);
    const bare = `export function load(text: string): unknown {\n  return JSON.parse(text);\n}\n`;
    expect(applyExperienceToSource(bare, []).applied).toBe(false);
  });

  it.skipIf(!STRIP_TYPES)('ne casse pas un renommage, remplace un test faible, et utilise basename', async () => {
    const rename = [
      'diff --git a/clean.ts b/clean.ts',
      '--- a/clean.ts',
      '+++ b/clean.ts',
      '@@ -1,4 +1,4 @@',
      ' export function clean(value: string): string {',
      '-  const tmp = value.trim();',
      '-  return tmp;',
      '+  const cleaned = value.trim();',
      '+  return cleaned;',
      ' }',
      '',
    ].join('\n');
    const record = learned({
      id: 'rename',
      request: 'Renommer le temporaire sans changer le resultat deja vert.',
      error: 'aucun changement de resultat',
      before: '',
      after: '',
      commands: ['node --test tidy.test.ts'],
      diff: rename,
    });
    const tidy = `export function tidy(value: string): string {\n  const tmp = value.trim();\n  return tmp;\n}\n`;
    const applied = applyExperienceToSource(tidy, [record], { language: 'typescript' });
    expect(applied.applied).toBe(true);
    expect(applied.source).not.toMatch(/\btmp\b/);
    const { b, empty } = await dirs();
    const test = projectTest('tidy', "test('espaces', () => { assert.equal(tidy('  ab  '), 'ab'); });");
    await writeFile(join(b, 'tidy.ts'), applied.source);
    await writeFile(join(b, 'tidy.test.ts'), test);
    expect(runTest(b, 'tidy.test.ts').status).toBe(0);
    await writeFile(join(empty, 'tidy.ts'), tidy);
    await writeFile(join(empty, 'tidy.test.ts'), test);
    expect(runTest(empty, 'tidy.test.ts').status).toBe(0);

    const partial = experienceReplacement(parseUnifiedDiff(rename));
    const oneLine = partial
      ? { ...record, hint: { from: partial.steps[1]?.from ?? '', to: partial.steps[1]?.to ?? '', language: 'typescript', steps: partial.steps.slice(1, 2) } }
      : record;
    expect(applyExperienceToSource(tidy, [oneLine], { language: 'typescript' }).applied).toBe(false);

    const both = [
      'diff --git a/width.ts b/width.ts',
      '--- a/width.ts',
      '+++ b/width.ts',
      '@@ -1,3 +1,3 @@',
      ' export function width(a: number, b: number): number {',
      '-  return a * b;',
      '+  return a + b;',
      ' }',
      'diff --git a/width.test.ts b/width.test.ts',
      '--- a/width.test.ts',
      '+++ b/width.test.ts',
      '@@ -3,3 +3,3 @@',
      " import { width as fn } from './width.ts';",
      " test('controle', () => {",
      '-  assert.equal(fn(2, 3), fn(2, 3));',
      '+  assert.equal(fn(2, 3), 5);',
      ' });',
      '',
    ].join('\n');
    const weak = learned({
      id: 'faible',
      request: 'Le test trop faible ne controle pas le resultat. Il se compare a lui-meme.',
      error: 'assertion qui se compare à elle-même',
      before: '',
      after: '',
      commands: ['node --test width.test.ts'],
      diff: both,
    });
    expect(weak.hint?.steps?.some((step) => step.role === 'test')).toBe(true);
    const span = `export function span(a: number, b: number): number {\n  return a * b;\n}\n`;
    const spanTest = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { span as fn } from './span.ts';\ntest('controle', () => {\n  assert.equal(fn(2, 3), fn(2, 3));\n});\n`;
    const { a } = await dirs();
    await writeFile(join(a, 'span.ts'), span);
    await writeFile(join(a, 'span.test.ts'), spanTest);
    expect(runTest(a, 'span.test.ts').status).toBe(0);
    const code = applyExperienceToSource(span, [weak], { language: 'typescript', role: 'source' });
    const check = applyExperienceToSource(spanTest, [weak], { language: 'typescript', role: 'test' });
    expect(code.source).toContain('return a + b;');
    expect(code.source).toContain('function span');
    expect(check.source).toContain('assert.equal(fn(2, 3), 5)');
    expect(check.source).not.toContain('width');
    await writeFile(join(a, 'span.ts'), code.source);
    await writeFile(join(a, 'span.test.ts'), check.source);
    const strong = runTest(a, 'span.test.ts');
    expect(strong.status, strong.output).toBe(0);
    const oracle = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { span as fn } from './span.ts';\ntest('oracle', () => { assert.equal(fn(2, 3), 5); });\n`;
    const emptyDir = join(a, '..', 'oracle');
    await mkdir(emptyDir);
    await writeFile(join(emptyDir, 'span.ts'), span);
    await writeFile(join(emptyDir, 'span.test.ts'), oracle);
    expect(runTest(emptyDir, 'span.test.ts').status).not.toBe(0);

    const api = [
      'diff --git a/leaf.ts b/leaf.ts',
      '--- a/leaf.ts',
      '+++ b/leaf.ts',
      '@@ -1,4 +1,4 @@',
      '-import { fileName } from \'node:path\';',
      '+import { basename } from \'node:path\';',
      ' export function leaf(p: string): string {',
      '-  return fileName(p);',
      '+  return basename(p);',
      ' }',
      '',
    ].join('\n');
    const apiRecord = learned({
      id: 'api',
      request: 'leaf importe un symbole absent du module path.',
      error: "SyntaxError: The requested module 'node:path' does not provide an export named 'fileName'",
      before: '',
      after: '',
      commands: ['node --test stem.test.ts'],
      diff: api,
    });
    const ask = 'stem importe un symbole qui n existe pas dans le module.';
    expect(ask).not.toContain('basename');
    const hits = retrieveExperiences([apiRecord], { query: ask, errors: apiRecord.errorSignature, language: 'typescript' });
    const stem = `import { fileName } from 'node:path';\nexport function stem(p: string): string {\n  return fileName(p);\n}\n`;
    const fixed = applyExperienceToSource(stem, hits.applicable, { language: 'typescript' });
    expect(fixed.applied).toBe(true);
    expect(fixed.source).toContain("import { basename } from 'node:path';");
    expect(fixed.source).toContain('return basename(p);');
    expect(fixed.source).not.toContain('fileName');
    expect(fixed.source).not.toContain('function leaf');
    const apiDir = join(a, '..', 'api');
    await mkdir(apiDir);
    await writeFile(join(apiDir, 'stem.ts'), fixed.source);
    await writeFile(
      join(apiDir, 'stem.test.ts'),
      projectTest('stem', "test('base', () => { assert.equal(stem('/a/b/c.txt'), 'c.txt'); });"),
    );
    const apiRun = runTest(apiDir, 'stem.test.ts');
    expect(apiRun.status, apiRun.output).toBe(0);
    const apiEmpty = join(a, '..', 'api-vide');
    await mkdir(apiEmpty);
    await writeFile(join(apiEmpty, 'stem.ts'), stem);
    await writeFile(
      join(apiEmpty, 'stem.test.ts'),
      projectTest('stem', "test('base', () => { assert.equal(stem('/a/b/c.txt'), 'c.txt'); });"),
    );
    expect(runTest(apiEmpty, 'stem.test.ts').status).not.toBe(0);
  });

  it('refuse Python, une version périmée, un essai raté et deux indices contradictoires', () => {
    const diff = [
      'diff --git a/last.ts b/last.ts',
      '--- a/last.ts',
      '+++ b/last.ts',
      '@@ -1,3 +1,3 @@',
      ' export function last(items: number[]): number | undefined {',
      '-  return items[items.length];',
      '+  return items[items.length - 1];',
      ' }',
      '',
    ].join('\n');
    const record = learned({
      id: 'ts',
      request: 'last lit apres le dernier element.',
      error: 'undefined',
      before: '',
      after: '',
      commands: ['node --test'],
      diff,
      version: 'v22.0.0',
    });
    const py = 'def last(items):\n  return items[items.length];\n';
    const blocked = applyExperienceToSource(py, [record], { language: 'python', version: 'v22.0.0' });
    expect(blocked.applied).toBe(false);
    expect(blocked.source).toBe(py);
    const stale = applyExperienceToSource(
      `export function end(items: number[]): number | undefined {\n  return items[items.length];\n}\n`,
      [record],
      { language: 'typescript', version: process.version },
    );
    expect(stale.applied).toBe(false);
    const other = {
      ...record,
      id: 'autre',
      hint: {
        from: 'return items[items.length];',
        to: 'return items[0];',
        language: 'typescript',
        steps: [{ from: 'return items[items.length];', to: 'return items[0];', role: 'source' as const }],
      },
    };
    const clash = applyExperienceToSource(
      `export function end(items: number[]): number | undefined {\n  return items[items.length];\n}\n`,
      [record, other],
      { language: 'typescript', version: 'v22.0.0' },
    );
    expect(clash.applied).toBe(false);
    expect(clash.uncertain).toMatch(/contradictoires/);
    expect(experienceFromMission({
      id: 'rate',
      now: 1,
      ok: false,
      request: 'essai',
      errorSignature: 'fail',
      cause: 'fail',
      fix: 'return a + b',
      testCommands: ['node --test'],
      beforeResult: 'rouge',
      afterResult: 'rouge',
      files: ['a.ts'],
      hint: { from: 'return a * b;', to: 'return a + b;' },
    })).toBeNull();
    const failed = experienceAttempt({
      id: 'rate',
      now: 1,
      request: 'dernier element encore faux',
      expected: 'le test de fin passe',
      happened: '3 !== undefined',
      likelyCause: 'lecture apres la fin',
      nextHypothesis: 'Décaler l’index dans le fichier de ce projet, puis relancer son test.',
      language: 'typescript',
    });
    expect(failed.status).toBe('rejected');
    expect(failed.hint).toBeUndefined();
    expect(failed.trace?.outcome).toBe('failed');
    expect(applyExperienceToSource(py, [failed], { language: 'python' }).applied).toBe(false);
    expect(relevantRecords([failed], 'dernier element').map((item) => item.id)).toEqual([]);
    expect(retrieveExperiences([failed], { query: 'dernier element' }).applicable).toEqual([]);
    const noise = Array.from({ length: 8 }, (_, index) => ({
      ...record,
      id: `bruit-${index}`,
      content: `recette de soupe numero ${index} avec des legumes`,
      errorSignature: 'soupe',
      cause: 'cuisine',
      fix: 'sel',
      hint: undefined,
      trace: { ...record.trace!, symptomIds: [], problemType: 'cuisine', problem: 'soupe' },
    }));
    const picked = retrieveExperiences([...noise, record], {
      query: 'end depasse la fin du tableau',
      language: 'typescript',
      version: 'v22.0.0',
    });
    expect(picked.applicable.map((item) => item.id)).toEqual(['ts']);
    expect(formatLearningContext(picked.applicable)).not.toContain('soupe');
    const retrieval = retrieveExperiences([record], { query: 'end depasse la fin du tableau', version: 'v99' });
    expect(retrieval.applicable).toEqual([]);
    expect(retrieval.stale.map((item) => item.id)).toEqual(['ts']);
  });
});
