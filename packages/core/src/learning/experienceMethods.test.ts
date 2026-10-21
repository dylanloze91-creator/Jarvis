import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { experienceAttempt, type LearningRecord } from './continuous.js';
import {
  applyMemoryToSource,
  applyMethod,
  correctMethod,
  methodFromObservation,
  noteMethodOutcome,
  retrieveMethods,
} from './methods.js';
import { applyExperienceToSource } from './continuous.js';

function runTest(cwd: string, file: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', file], {
    cwd,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

function card(from: string, to: string): LearningRecord {
  return {
    id: 'carte',
    type: 'experience',
    content: 'correctif exact du projet d’origine',
    origin: 'mission',
    createdAt: 1,
    lastCheckedAt: 1,
    confidence: 0.85,
    confidenceReason: 'carte exacte',
    status: 'validated',
    sources: [],
    links: [],
    hint: { from, to, language: 'typescript', steps: [{ from, to, role: 'source' }] },
    trace: {
      problem: 'origine',
      context: 'origine',
      firstTry: 'essai',
      observedErrors: '',
      appliedFix: 'ligne exacte',
      testsRun: [],
      finalResult: 'vert',
      limits: 'ligne exacte',
      language: 'typescript',
      problemType: 'expérience',
      runtimeVersion: process.version,
      outcome: 'passed',
    },
  };
}

function methodFor(kindSetup: {
  id: string;
  request: string;
  before: string;
  after: string;
  origin: string;
}): LearningRecord {
  const record = methodFromObservation({
    id: kindSetup.id,
    now: 1,
    ok: true,
    language: 'typescript',
    request: kindSetup.request,
    beforeSource: kindSetup.before,
    afterSource: kindSetup.after,
    tests: '',
    runtimeVersion: process.version,
    originLabel: kindSetup.origin,
  });
  if (!record?.method) throw new Error(`méthode absente pour ${kindSetup.id}`);
  return record;
}

async function project(name: string, source: string, spec: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), `jarvis-meth-${name}-`));
  const file = `${name}.ts`;
  await writeFile(join(dir, file), source);
  await writeFile(join(dir, `${name}.test.ts`), spec);
  return { dir, file };
}

function spec(fn: string, body: string): string {
  return `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { ${fn} } from './${fn}.ts';\n${body}\n`;
}

describe('méthodes extraites, pas la ligne d’origine', () => {
  it('corrige un autre opérateur sans coller return a + b', async () => {
    const record = methodFor({
      id: 'align',
      request: 'la fonction devrait additionner',
      before: 'return a * b;',
      after: 'return a + b;',
      origin: 'projet-produit',
    });
    const dumped = JSON.stringify(record);
    expect(dumped).not.toContain('return a + b');
    expect(dumped).not.toContain('return a * b');
    expect(dumped).not.toContain('a * b');
    expect(record.status).toBe('candidate');
    expect(record.type).toBe('procedure');
    expect(record.hint).toBeUndefined();
    expect(record.method?.kind).toBe('align-return');
    expect(record.method?.evidence[0]?.label).toBe('projet-produit');
    const source = 'export function offset(n, k) {\n  return n - k;\n}\n';
    const tests = spec(
      'offset',
      `test('normal', () => { assert.equal(offset(10, 3), 13); });
test('zero', () => { assert.equal(offset(0, 0), 0); });
test('negatif', () => { assert.equal(offset(-2, 5), 3); });`,
    );
    expect(source).not.toContain('return a + b');
    const exact = applyExperienceToSource(source, [card('return a * b', 'return a + b')], {
      language: 'typescript',
      version: process.version,
    });
    expect(exact.applied).toBe(false);
    const { dir } = await project('offset', exact.source, tests);
    expect(runTest(dir, 'offset.test.ts').status).not.toBe(0);
    const applied = applyMethod(source, tests, [record], { language: 'typescript', version: process.version });
    expect(applied.applied).toBe(true);
    expect(applied.source).toContain('return n + k;');
    expect(applied.source).not.toContain('return a + b');
    expect(applied.source).not.toContain('a * b');
    const held = await project('offset', applied.source, tests);
    const result = runTest(held.dir, 'offset.test.ts');
    expect(result.status).toBe(0);
    const reused = noteMethodOutcome(record, { ok: true, context: 'offset', now: 2 });
    expect(reused.status).toBe('validated');
    expect(reused.method?.helped).toEqual(['offset']);
    expect(reused.method?.steps).toEqual(record.method?.steps);
  });

  it('protège une liste vide avec la valeur de CE test, pas 0', async () => {
    const record = methodFor({
      id: 'vide',
      request: 'une liste vide ne doit pas donner un nombre illisible',
      before: 'return sum / items.length;',
      after: 'return items.length === 0 ? 0 : sum / items.length;',
      origin: 'projet-moyenne',
    });
    expect(JSON.stringify(record)).not.toContain('? 0');
    expect(JSON.stringify(record)).not.toContain('items.length');
    const source = 'export function mean(values) {\n  const total = values.reduce((s, n) => s + n, 0);\n  return total / values.length;\n}\n';
    const tests = spec(
      'mean',
      `test('vide', () => { assert.equal(mean([]), -1); });
test('deux', () => { assert.equal(mean([2, 4]), 3); });
test('un', () => { assert.equal(mean([5]), 5); });`,
    );
    const exact = applyExperienceToSource(
      source,
      [card('return sum / items.length', 'return items.length === 0 ? 0 : sum / items.length')],
      { language: 'typescript', version: process.version },
    );
    expect(exact.applied).toBe(false);
    expect(exact.source).not.toContain('? 0');
    const applied = applyMethod(source, tests, [record], { language: 'typescript', version: process.version });
    expect(applied.source).toContain('? -1');
    expect(applied.source).not.toContain('? 0');
    expect(applied.source).not.toContain('items');
    const { dir } = await project('mean', applied.source, tests);
    expect(runTest(dir, 'mean.test.ts').status).toBe(0);
  });

  it('la méthode bat l’absence de mémoire ; la carte exacte reste le repère', async () => {
    const source =
      'export function mean(values) {\n  const total = values.reduce((s, n) => s + n, 0);\n  return total / values.length;\n}\n';
    const tests = spec(
      'mean',
      `test('vide', () => { assert.equal(mean([]), -1); });
test('deux', () => { assert.equal(mean([2, 4]), 3); });
test('un', () => { assert.equal(mean([5]), 5); });`,
    );
    expect(source).not.toContain('? 0');
    expect(source).not.toContain('items');
    const options = { language: 'typescript' as const, version: process.version };
    const none = applyMemoryToSource(source, tests, [], options);
    expect(none.changed).toBe(false);
    expect(none.experienceApplied).toBe(false);
    expect(none.methodApplied).toBe(false);
    const bare = await project('mean', none.source, tests);
    expect(runTest(bare.dir, 'mean.test.ts').status).not.toBe(0);

    const stored = card(
      'return sum / items.length;',
      'return items.length === 0 ? 0 : sum / items.length;',
    );
    const baseline = applyMemoryToSource(source, tests, [stored], options);
    expect(baseline.experienceApplied).toBe(false);
    expect(baseline.methodApplied).toBe(false);
    expect(baseline.source).not.toContain('? 0');
    const heldCard = await project('mean', baseline.source, tests);
    expect(runTest(heldCard.dir, 'mean.test.ts').status).not.toBe(0);

    const memorized = card(
      'return total / values.length;',
      'return values.length === 0 ? 0 : total / values.length;',
    );
    const pasted = applyMemoryToSource(source, tests, [memorized], options);
    expect(pasted.experienceApplied).toBe(true);
    expect(pasted.source).toContain('? 0');
    const red = await project('mean', pasted.source, tests);
    expect(runTest(red.dir, 'mean.test.ts').status).not.toBe(0);

    const record = methodFor({
      id: 'vide-memoire',
      request: 'une liste vide ne doit pas donner un nombre illisible',
      before: 'return sum / items.length;',
      after: 'return items.length === 0 ? 0 : sum / items.length;',
      origin: 'projet-moyenne',
    });
    expect(JSON.stringify(record)).not.toContain('? 0');
    expect(JSON.stringify(record)).not.toContain('items');
    const method = applyMemoryToSource(source, tests, [stored, record], options);
    expect(method.experienceApplied).toBe(false);
    expect(method.methodApplied).toBe(true);
    expect(method.methodId).toBe(record.id);
    expect(method.source).toContain('? -1');
    expect(method.source).not.toContain('? 0');
    expect(method.source).not.toContain('items');
    const green = await project('mean', method.source, tests);
    expect(runTest(green.dir, 'mean.test.ts').status).toBe(0);
  });

  it('déduit le séparateur des tests au lieu de coller le tiret', async () => {
    const record = methodFor({
      id: 'join',
      request: 'joindre les mots',
      before: 'return parts.join();',
      after: "return parts.join('-');",
      origin: 'projet-tiret',
    });
    expect(JSON.stringify(record)).not.toContain("join('-')");
    expect(JSON.stringify(record)).not.toContain('join("-")');
    const source = 'export function label(words) {\n  return words.join();\n}\n';
    const tests = spec(
      'label',
      `test('deux', () => { assert.equal(label(['x', 'y']), 'x/y'); });
test('trois', () => { assert.equal(label(['a', 'b', 'c']), 'a/b/c'); });
test('un', () => { assert.equal(label(['a']), 'a'); });
test('vide', () => { assert.equal(label([]), ''); });`,
    );
    const exact = applyExperienceToSource(source, [card('return parts.join();', "return parts.join('-');")], {
      language: 'typescript',
      version: process.version,
    });
    expect(exact.applied).toBe(true);
    expect(exact.source).toContain("join('-')");
    const red = await project('label', exact.source, tests);
    expect(runTest(red.dir, 'label.test.ts').status).not.toBe(0);
    const applied = applyMethod(source, tests, [record], { language: 'typescript', version: process.version });
    expect(applied.source).toContain('join("/")');
    expect(applied.source).not.toContain("join('-')");
    const green = await project('label', applied.source, tests);
    expect(runTest(green.dir, 'label.test.ts').status).toBe(0);
  });

  it('remplace un JSON illisible par la valeur des tests, pas null', async () => {
    const record = methodFor({
      id: 'parse',
      request: 'un texte inutilisable ne doit pas lever',
      before: 'return JSON.parse(text);',
      after: 'try {\n  return JSON.parse(text);\n} catch {\n  return null;\n}',
      origin: 'projet-null',
    });
    expect(JSON.stringify(record)).not.toContain('return null');
    const source = 'export function read(raw) {\n  return JSON.parse(raw);\n}\n';
    const tests = spec(
      'read',
      `test('objet', () => { assert.deepEqual(read('{"ok":true}'), { ok: true }); });
test('inutilisable', () => { assert.deepEqual(read('not-json'), []); });`,
    );
    const exact = applyExperienceToSource(
      source,
      [card('return JSON.parse(text)', 'try {\n  return JSON.parse(text);\n} catch {\n  return null;\n}')],
      { language: 'typescript', version: process.version },
    );
    expect(exact.applied).toBe(false);
    const applied = applyMethod(source, tests, [record], { language: 'typescript', version: process.version });
    expect(applied.applied).toBe(true);
    expect(applied.source).toContain('return [];');
    expect(applied.source).not.toContain('return null');
    expect(applied.source).not.toContain('JSON.parse(text)');
    const { dir } = await project('read', applied.source, tests);
    expect(runTest(dir, 'read.test.ts').status).toBe(0);
  });

  it('convertit le reçu de CE fichier sans coller trim', async () => {
    const record = methodFor({
      id: 'coerce',
      request: 'une méthode de texte est appelée sur un nombre',
      before: 'return value.trim();',
      after: 'return String(value).trim();',
      origin: 'projet-texte',
    });
    expect(JSON.stringify(record)).not.toContain('trim');
    const source = "export function show(n) {\n  return n.concat('!');\n}\n";
    const tests = spec(
      'show',
      `test('trois', () => { assert.equal(show(3), '3!'); });
test('zero', () => { assert.equal(show(0), '0!'); });`,
    );
    expect(source).not.toContain('trim');
    const exact = applyExperienceToSource(source, [card('return value.trim()', 'return String(value).trim()')], {
      language: 'typescript',
      version: process.version,
    });
    expect(exact.applied).toBe(false);
    const applied = applyMethod(source, tests, [record], { language: 'typescript', version: process.version });
    expect(applied.source).toContain("String(n).concat('!')");
    expect(applied.source).not.toContain('trim');
    const { dir } = await project('show', applied.source, tests);
    expect(runTest(dir, 'show.test.ts').status).toBe(0);
  });

  it('choisit dirname parce que les tests l’attendent, pas basename', async () => {
    const record = methodFor({
      id: 'api',
      request: 'le symbole absent doit être la fonction documentée',
      before: 'return filename(fileName);',
      after: 'return basename(fileName);',
      origin: 'projet-nom',
    });
    expect(JSON.stringify(record)).not.toContain('return basename');
    expect(JSON.stringify(record)).not.toContain('filename');
    const source = "import { folder } from 'node:path';\nexport function directory(p) {\n  return folder(p);\n}\n";
    const tests = spec(
      'directory',
      `test('parent', () => { assert.equal(directory('/a/b/c.txt'), '/a/b'); });
test('seul', () => { assert.equal(directory('c.txt'), '.'); });`,
    );
    const exact = applyExperienceToSource(source, [card('return filename(fileName)', 'return basename(fileName)')], {
      language: 'typescript',
      version: process.version,
    });
    expect(exact.applied).toBe(false);
    expect(exact.source).not.toContain('basename');
    const applied = applyMethod(source, tests, [record], { language: 'typescript', version: process.version });
    expect(applied.applied).toBe(true);
    expect(applied.source).toContain('dirname');
    expect(applied.source).not.toContain('basename');
    expect(applied.source).not.toContain('folder');
    const { dir } = await project('directory', applied.source, tests);
    expect(runTest(dir, 'directory.test.ts').status).toBe(0);
  });

  it('ne change pas un fichier dont les tests passent déjà', async () => {
    const record = methodFor({
      id: 'vert',
      request: 'refactor qui ne doit pas casser les tests',
      before: 'return w * h;',
      after: 'return w * h;',
      origin: 'projet-aire',
    });
    expect(record.method?.kind).toBe('keep-green');
    const source = 'export function area(w, h) {\n  return w * h;\n}\n';
    const tests = spec(
      'area',
      `test('normal', () => { assert.equal(area(3, 4), 12); });
test('zero', () => { assert.equal(area(0, 5), 0); });`,
    );
    const applied = applyMethod(source, tests, [record], { language: 'typescript', version: process.version });
    expect(applied.applied).toBe(false);
    expect(applied.held).toBe(true);
    expect(applied.source).toBe(source);
    const { dir } = await project('area', applied.source, tests);
    expect(runTest(dir, 'area.test.ts').status).toBe(0);
  });

  it('recule d’un cran avec le nom local, et la carte exacte le fait aussi', async () => {
    const record = methodFor({
      id: 'fin',
      request: 'lire le dernier élément',
      before: 'return items[items.length];',
      after: 'return items[items.length - 1];',
      origin: 'projet-tableau',
    });
    expect(JSON.stringify(record)).not.toContain('items');
    const source = 'export function end(rows) {\n  return rows[rows.length];\n}\n';
    const tests = spec(
      'end',
      `test('fin', () => { assert.equal(end(['a', 'b', 'c']), 'c'); });
test('seul', () => { assert.equal(end(['seul']), 'seul'); });`,
    );
    const exact = applyExperienceToSource(source, [card('return items[items.length];', 'return items[items.length - 1];')], {
      language: 'typescript',
      version: process.version,
    });
    expect(exact.applied).toBe(true);
    const slot = await project('end', exact.source, tests);
    expect(runTest(slot.dir, 'end.test.ts').status).toBe(0);
    const applied = applyMethod(source, tests, [record], { language: 'typescript', version: process.version });
    expect(applied.source).toContain('rows[rows.length - 1]');
    expect(applied.source).not.toContain('items');
    const held = await project('end', applied.source, tests);
    expect(runTest(held.dir, 'end.test.ts').status).toBe(0);
  });

  it('ne écrit rien si plusieurs opérateurs conviennent, et n’en tire pas une mise à jour', () => {
    const record = methodFor({
      id: 'flou',
      request: 'la fonction devrait additionner',
      before: 'return a * b;',
      after: 'return a + b;',
      origin: 'projet-produit',
    });
    const source = 'export function mix(a, b) {\n  return a * b;\n}\n';
    const tests = spec('mix', `test('seul', () => { assert.equal(mix(2, 2), 4); });`);
    const applied = applyMethod(source, tests, [record], { language: 'typescript', version: process.version });
    expect(applied.applied).toBe(false);
    expect(applied.uncertain).toMatch(/plusieurs opérateurs/i);
    expect(applied.source).toBe(source);
    const noted = noteMethodOutcome(record, {
      ok: false,
      uncertain: true,
      context: 'mix',
      cause: applied.uncertain,
      now: 5,
    });
    expect(noted.status).toBe('candidate');
    expect(noted.method?.steps).toEqual(record.method?.steps);
    expect(noted.method?.helped).toEqual([]);
    expect(noted.method?.failures.at(-1)?.uncertain).toBe(true);
  });

  it('garde une méthode qui a marché ailleurs quand un contexte échoue', () => {
    const record = methodFor({
      id: 'align',
      request: 'la fonction devrait additionner',
      before: 'return a * b;',
      after: 'return a + b;',
      origin: 'projet-produit',
    });
    const validated = noteMethodOutcome(record, { ok: true, context: 'offset', now: 2 });
    const failed = noteMethodOutcome(validated, {
      ok: false,
      context: 'formule',
      cause: 'le return n’est pas un opérateur simple',
      now: 3,
    });
    expect(failed.status).toBe('validated');
    expect(failed.method?.helped).toEqual(['offset']);
    expect(failed.method?.failures[0]?.cause).toMatch(/opérateur simple/);
    expect(failed.method?.failures[0]?.uncertain).toBe(false);
    expect(failed.method?.steps).toEqual(record.method?.steps);
  });

  it('ignore un essai rejeté et un échec de mission', () => {
    expect(
      methodFromObservation({
        id: 'non',
        now: 1,
        ok: false,
        language: 'typescript',
        request: 'échec',
        beforeSource: 'return a * b;',
        afterSource: 'return a + b;',
        tests: '',
      }),
    ).toBeNull();
    const attempt = experienceAttempt({
      id: 'rate',
      now: 1,
      request: 'la fonction devrait additionner',
      expected: '13',
      happened: '7',
      likelyCause: 'opérateur soustraction',
      nextHypothesis: 'relire les exemples',
      language: 'typescript',
    });
    expect(attempt.status).toBe('rejected');
    expect(attempt.method).toBeUndefined();
    const source = 'export function offset(n, k) {\n  return n - k;\n}\n';
    const tests = spec('offset', `test('normal', () => { assert.equal(offset(10, 3), 13); });`);
    const applied = applyMethod(source, tests, [attempt], { language: 'typescript', version: process.version });
    expect(applied.applied).toBe(false);
    expect(applied.source).toBe(source);
  });

  it('retrouve par symptôme, pas tout l’index, et ignore une autre version ou Python', () => {
    const record = methodFor({
      id: 'align',
      request: 'la fonction devrait additionner',
      before: 'return a * b;',
      after: 'return a + b;',
      origin: 'projet-produit',
    });
    const noise = Array.from({ length: 8 }, (_, index) =>
      methodFor({
        id: `soup-${index}`,
        request: `refactor de la recette ${index} qui ne doit pas casser les tests`,
        before: 'return w * h;',
        after: 'return w * h;',
        origin: `cuisine-${index}`,
      }),
    );
    expect(noise.every((item) => item.method?.kind === 'keep-green')).toBe(true);
    const source = 'export function offset(n, k) {\n  return n - k;\n}\n';
    const tests = spec('offset', `test('normal', () => { assert.equal(offset(10, 3), 13); });`);
    const found = retrieveMethods([...noise, record], {
      query: 'offset devrait suivre les exemples',
      language: 'typescript',
      version: process.version,
      source,
      tests,
      limit: 4,
    });
    expect(found.applicable.map((item) => item.id)).toEqual(['align']);
    const stale = retrieveMethods([record], {
      query: 'mauvais opérateur',
      language: 'typescript',
      version: 'v0.0.0',
    });
    expect(stale.applicable).toEqual([]);
    expect(stale.stale).toHaveLength(1);
    const old = { ...record, trace: { ...record.trace!, runtimeVersion: 'v0.0.0' } };
    const blocked = applyMethod(source, tests, [old], { language: 'typescript', version: process.version });
    expect(blocked.applied).toBe(false);
    expect(blocked.source).toBe(source);
    const python = 'def offset(n, k):\n    return n - k\n';
    const skipped = applyMethod(python, tests, [record], { language: 'python', version: process.version });
    expect(skipped.source).toBe(python);
  });

  it('passe en revue quand le texte est corrigé, et se supprime par le statut rejeté', () => {
    const record = methodFor({
      id: 'align',
      request: 'la fonction devrait additionner',
      before: 'return a * b;',
      after: 'return a + b;',
      origin: 'projet-produit',
    });
    const reviewed = correctMethod(record, 'Lire les tests de ce projet avant de changer l’opérateur.', 9);
    expect(reviewed.status).toBe('review');
    expect(reviewed.content).toMatch(/Lire les tests/);
    expect(reviewed.method?.kind).toBe(record.method?.kind);
    expect(reviewed.method?.steps).toEqual(record.method?.steps);
    const rejected = { ...reviewed, status: 'rejected' as const };
    const source = 'export function offset(n, k) {\n  return n - k;\n}\n';
    const tests = spec(
      'offset',
      `test('normal', () => { assert.equal(offset(10, 3), 13); });
test('zero', () => { assert.equal(offset(0, 0), 0); });`,
    );
    const still = applyMethod(source, tests, [reviewed], { language: 'typescript', version: process.version });
    expect(still.applied).toBe(true);
    const dropped = applyMethod(source, tests, [rejected], { language: 'typescript', version: process.version });
    expect(dropped.applied).toBe(false);
  });

  it('après redémarrage, un nouveau problème utilise la méthode validée', async () => {
    const record = methodFor({
      id: 'align',
      request: 'la fonction devrait additionner',
      before: 'return a * b;',
      after: 'return a + b;',
      origin: 'projet-produit',
    });
    const validated = noteMethodOutcome(record, { ok: true, context: 'offset', now: 2 });
    expect(validated.status).toBe('validated');
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-restart-'));
    const source = 'export function total(p, q) {\n  return p * q;\n}\n';
    const tests = spec(
      'total',
      `test('normal', () => { assert.equal(total(4, 5), 9); });
test('bord', () => { assert.equal(total(0, 1), 1); });
test('negatif', () => { assert.equal(total(-2, 2), 0); });`,
    );
    expect(source).not.toContain('return a + b');
    await writeFile(join(dir, 'store.json'), JSON.stringify([validated]));
    await writeFile(join(dir, 'total.ts'), source);
    await writeFile(join(dir, 'total.test.ts'), tests);
    await writeFile(
      join(dir, 'resolve.mjs'),
      `export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.js')) {
    try { return await next(specifier.slice(0, -3) + '.ts', context); } catch { return next(specifier, context); }
  }
  return next(specifier, context);
}
`,
    );
    const methodsPath = fileURLToPath(new URL('./methods.ts', import.meta.url));
    await writeFile(
      join(dir, 'child.mjs'),
      `import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
register(pathToFileURL(process.argv[2]));
const { applyMethod } = await import(process.argv[3]);
const dir = process.argv[4];
const store = JSON.parse(readFileSync(join(dir, 'store.json'), 'utf8'));
const source = readFileSync(join(dir, 'total.ts'), 'utf8');
const tests = readFileSync(join(dir, 'total.test.ts'), 'utf8');
const applied = applyMethod(source, tests, store, { language: 'typescript', version: process.version });
if (!applied.applied) {
  console.error(JSON.stringify(applied));
  process.exit(2);
}
writeFileSync(join(dir, 'total.ts'), applied.source);
`,
    );
    const child = spawnSync(process.execPath, ['--experimental-strip-types', join(dir, 'child.mjs'), join(dir, 'resolve.mjs'), methodsPath, dir], {
      encoding: 'utf8',
    });
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
    const written = await readFile(join(dir, 'total.ts'), 'utf8');
    expect(written).toContain('return p + q;');
    expect(written).not.toContain('return a + b');
    expect(written).not.toContain('a * b');
    expect(runTest(dir, 'total.test.ts').status).toBe(0);
  });
});
