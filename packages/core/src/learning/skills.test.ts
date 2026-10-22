import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LearningRecord } from './continuous.js';
import { applyExperienceToSource } from './continuous.js';
import {
  admitSkill,
  applySkill,
  applySkillTrial,
  rejectSkill,
  restoreSkillVersion,
  reviseSkill,
  selectSkill,
  settleSkill,
  skillFromObservation,
  skillTrainRows,
} from './skills.js';

function runTest(cwd: string, file: string): { status: number | null } {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', file], {
    cwd,
    encoding: 'utf8',
  });
  return { status: result.status };
}

function spec(fn: string, body: string): string {
  return `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { ${fn} } from './${fn}.ts';\n${body}\n`;
}

function card(from: string, to: string): LearningRecord {
  return {
    id: 'carte',
    type: 'experience',
    content: 'correctif exact',
    origin: 'mission',
    createdAt: 1,
    lastCheckedAt: 1,
    confidence: 0.85,
    confidenceReason: 'carte',
    status: 'validated',
    sources: [],
    links: [],
    hint: { from, to, language: 'typescript', steps: [{ from, to, role: 'source' }] },
    trace: {
      problem: 'origine',
      context: 'origine',
      firstTry: 'essai',
      observedErrors: '',
      appliedFix: 'ligne',
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

function candidate(id: string, before: string, after: string, origin: string, request: string): LearningRecord {
  const record = skillFromObservation({
    id,
    now: 1,
    ok: true,
    language: 'typescript',
    request,
    beforeSource: before,
    afterSource: after,
    tests: '',
    runtimeVersion: process.version,
    originLabel: origin,
  });
  if (!record?.skill) throw new Error(`compétence absente pour ${id}`);
  return record;
}

async function project(name: string, source: string, body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `jarvis-skill-${name}-`));
  await writeFile(join(dir, `${name}.ts`), source);
  await writeFile(join(dir, `${name}.test.ts`), spec(name, body));
  return dir;
}

const options = { language: 'typescript', version: process.version, validatedOnly: true };

describe('compétences exécutables', () => {
  it('crée une candidate, la valide sur un autre problème, et s’en sert sans l’ancienne ligne', async () => {
    expect(skillFromObservation({
      id: 'rate',
      now: 1,
      ok: false,
      language: 'typescript',
      request: 'addition',
      beforeSource: 'return a * b;',
      afterSource: 'return a + b;',
      tests: '',
      originLabel: 'projet-produit',
    })).toBeNull();
    const created = candidate('align', 'return a * b;', 'return a + b;', 'projet-produit', 'la fonction devrait additionner');
    expect(created.status).toBe('candidate');
    expect(created.skill?.skillId).toBe('competence:align-return:typescript');
    expect(created.skill?.name).toBe('Aligner le retour');
    expect(created.skill?.tools.length).toBeGreaterThan(0);
    expect(created.skill?.checks.length).toBeGreaterThan(0);
    const dumped = JSON.stringify(created);
    expect(dumped).not.toContain('return a + b');
    expect(dumped).not.toContain('a * b');
    const same = settleSkill(created, { ok: true, context: 'projet-produit', now: 2 });
    expect(same.status).toBe('candidate');

    const checkSource = 'export function sum(u, v) {\n  return u * v;\n}\n';
    const checkTests = spec('sum', `test('normal', () => { assert.equal(sum(2, 5), 7); });`);
    const trial = applySkillTrial(checkSource, checkTests, [created], options);
    expect(trial.used).toBe(true);
    expect(trial.source).toContain('return u + v;');
    expect(trial.source).not.toContain('return a + b');
    const checkDir = await project('sum', trial.source, `test('normal', () => { assert.equal(sum(2, 5), 7); });`);
    expect(runTest(checkDir, 'sum.test.ts').status).toBe(0);
    const validated = settleSkill(created, { ok: true, context: 'somme', now: 3 });
    expect(validated.status).toBe('validated');
    expect(validated.skill?.results.some((result) => result.ok && result.context === 'somme')).toBe(true);
    expect(validated.method?.steps).toEqual(created.method?.steps);

    const source = 'export function offset(n, k) {\n  return n - k;\n}\n';
    const tests = spec(
      'offset',
      `test('normal', () => { assert.equal(offset(10, 3), 13); });
test('zero', () => { assert.equal(offset(0, 0), 0); });`,
    );
    expect(source).not.toContain('return a + b');
    const bare = applySkill(source, tests, [], options);
    expect(bare.used).toBe(false);
    expect(bare.selectedId).toBeNull();
    const bareDir = await project(
      'offset',
      bare.source,
      `test('normal', () => { assert.equal(offset(10, 3), 13); });
test('zero', () => { assert.equal(offset(0, 0), 0); });`,
    );
    expect(runTest(bareDir, 'offset.test.ts').status).not.toBe(0);
    const exact = applyExperienceToSource(source, [card('return a * b;', 'return a + b;')], options);
    expect(exact.applied).toBe(false);
    const skill = applySkill(source, tests, [validated], options);
    expect(skill.used).toBe(true);
    expect(skill.selectedId).toBe(validated.skill?.skillId);
    expect(skill.selectedName).toBe('Aligner le retour');
    expect(skill.source).toContain('return n + k;');
    expect(skill.source).not.toContain('return a + b');
    const held = await project(
      'offset',
      skill.source,
      `test('normal', () => { assert.equal(offset(10, 3), 13); });
test('zero', () => { assert.equal(offset(0, 0), 0); });`,
    );
    expect(runTest(held, 'offset.test.ts').status).toBe(0);

    const other = 'export function gap(p, q) {\n  return p * q;\n}\n';
    const otherTests = spec('gap', `test('normal', () => { assert.equal(gap(4, 5), 9); });`);
    expect(other).not.toContain('return a + b');
    const reused = applySkill(other, otherTests, [validated], options);
    expect(reused.used).toBe(true);
    expect(reused.source).toContain('return p + q;');
    const otherDir = await project('gap', reused.source, `test('normal', () => { assert.equal(gap(4, 5), 9); });`);
    expect(runTest(otherDir, 'gap.test.ts').status).toBe(0);
  });

  it('rejette une compétence inutile, ignore un doublon, et rétablit la version précédente', () => {
    const created = candidate('align', 'return a * b;', 'return a + b;', 'projet-produit', 'addition');
    const useless = rejectSkill(created, 'elle ne fait pas passer les tests', 4);
    expect(useless.status).toBe('rejected');
    expect(useless.method?.steps).toEqual(created.method?.steps);
    const source = 'export function offset(n, k) {\n  return n - k;\n}\n';
    const tests = spec('offset', `test('normal', () => { assert.equal(offset(10, 3), 13); });`);
    expect(selectSkill([useless], { source, tests, ...options })).toBeNull();
    expect(applySkill(source, tests, [useless], options).used).toBe(false);

    const again = candidate('align-2', 'return a * b;', 'return a + b;', 'autre-origine', 'addition');
    const admitted = admitSkill([created], again);
    expect(admitted.action).toBe('duplicate');
    expect(admitted.records).toHaveLength(1);
    expect(admitted.id).toBe(created.id);

    const validated = settleSkill(created, { ok: true, context: 'somme', now: 3 });
    const limited = settleSkill(validated, { ok: false, context: 'hors-sujet', cause: 'opérateur déjà bon', now: 5 });
    expect(limited.status).toBe('validated');
    expect(limited.method?.steps).toEqual(validated.method?.steps);
    expect(limited.skill?.limits.some((limit) => limit.includes('opérateur déjà bon'))).toBe(true);
    const previous = limited.skill?.history.at(-1);
    expect(previous).toBeTruthy();
    const restored = restoreSkillVersion(limited, previous!.revision);
    expect(restored.status).toBe('validated');
    expect(restored.skill?.limits).toEqual(validated.skill?.limits);
    expect(restored.method?.steps).toEqual(validated.method?.steps);

    const { kept, created: newer } = reviseSkill(validated, 'Lire les tests avant de choisir l’opérateur.', 6, 'align-v2');
    expect(kept).toBe(validated);
    expect(newer?.status).toBe('candidate');
    expect(newer?.skill?.version).toBe(2);
    expect(newer?.skill?.previousId).toBe(validated.id);
    expect(newer?.method?.steps).toEqual(validated.method?.steps);
    const picked = selectSkill([kept, newer!], { source, tests, ...options });
    expect(picked?.id).toBe(validated.id);
  });

  it('ne charge pas toute la bibliothèque, n’écrit rien sur un fichier déjà vert, et écarte un mauvais export', () => {
    const align = settleSkill(
      candidate('align', 'return a * b;', 'return a + b;', 'projet-produit', 'addition'),
      { ok: true, context: 'somme', now: 3 },
    );
    const noise = Array.from({ length: 8 }, (_, index) =>
      settleSkill(
        candidate(
          `vert-${index}`,
          'return w * h;',
          'return w * h;',
          `cuisine-${index}`,
          'refactor qui ne doit pas casser les tests',
        ),
        { ok: true, context: `plat-${index}`, now: 3 },
      ),
    );
    expect(noise.every((item) => item.method?.kind === 'keep-green')).toBe(true);
    const source = 'export function offset(n, k) {\n  return n - k;\n}\n';
    const tests = spec('offset', `test('normal', () => { assert.equal(offset(10, 3), 13); });`);
    const picked = selectSkill([...noise, align], { source, tests, ...options });
    expect(picked?.id).toBe('align');
    const green = 'export function area(w, h) {\n  return w * h;\n}\n';
    const greenTests = spec('area', `test('normal', () => { assert.equal(area(3, 4), 12); });`);
    const held = applySkill(green, greenTests, [align, ...noise], { ...options, query: 'ne pas casser les tests' });
    expect(held.source).toBe(green);
    expect(held.used).toBe(false);
    const python = 'def offset(n, k):\n    return n - k\n';
    expect(applySkill(python, tests, [align], { ...options, language: 'python' }).source).toBe(python);

    const thin = { ...align, skill: { ...align.skill!, examples: [], results: [] } };
    const contradictory = settleSkill(align, { ok: false, context: 'somme', cause: 'résultat opposé', now: 8 });
    expect(skillTrainRows([thin, contradictory, align])).toEqual([
      expect.objectContaining({
        method: 'Aligner le retour (align-return)',
        expected: 'les tests de ce contexte ont passé',
      }),
    ]);
    expect(JSON.stringify(skillTrainRows([align]))).not.toContain('return a + b');
  });

  it('reconnaît repeat comme la même compétence que trim, sans coller trim', async () => {
    const validated = settleSkill(
      candidate('texte', 'return value.trim();', 'return String(value).trim();', 'projet-texte', 'afficher le nombre'),
      { ok: true, context: 'show', now: 3 },
    );
    const source = 'export function mark(n) {\n  return n.repeat(2);\n}\n';
    const tests = spec('mark', `test('trois', () => { assert.equal(mark(3), '33'); });`);
    expect(source).not.toContain('trim');
    const skill = applySkill(source, tests, [validated], options);
    expect(skill.used).toBe(true);
    expect(skill.selectedName).toBe('Convertir avant une méthode de texte');
    expect(skill.source).toContain('String(n).repeat(2)');
    expect(skill.source).not.toContain('trim');
    const dir = await project('mark', skill.source, `test('trois', () => { assert.equal(mark(3), '33'); });`);
    expect(runTest(dir, 'mark.test.ts').status).toBe(0);
  });

  it('après redémarrage, un nouveau projet sélectionne la compétence validée', async () => {
    const validated = settleSkill(
      candidate('align', 'return a * b;', 'return a + b;', 'projet-produit', 'addition'),
      { ok: true, context: 'somme', now: 3 },
    );
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-skill-restart-'));
    const source = 'export function total(p, q) {\n  return p * q;\n}\n';
    const tests = spec('total', `test('normal', () => { assert.equal(total(4, 5), 9); });`);
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
    const skillsPath = fileURLToPath(new URL('./skills.ts', import.meta.url));
    await writeFile(
      join(dir, 'child.mjs'),
      `import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
register(pathToFileURL(process.argv[2]));
const { applySkill, selectSkill } = await import(process.argv[3]);
const dir = process.argv[4];
const store = JSON.parse(readFileSync(join(dir, 'store.json'), 'utf8'));
const source = readFileSync(join(dir, 'total.ts'), 'utf8');
const tests = readFileSync(join(dir, 'total.test.ts'), 'utf8');
const options = { language: 'typescript', version: process.version, validatedOnly: true, source, tests };
const selected = selectSkill(store, options);
if (!selected || selected.skill.skillId !== 'competence:align-return:typescript') process.exit(3);
const applied = applySkill(source, tests, store, options);
if (!applied.used) process.exit(2);
writeFileSync(join(dir, 'total.ts'), applied.source);
writeFileSync(join(dir, 'used.json'), JSON.stringify({ selected: applied.selectedId, name: applied.selectedName }));
`,
    );
    const child = spawnSync(
      process.execPath,
      ['--experimental-strip-types', join(dir, 'child.mjs'), join(dir, 'resolve.mjs'), skillsPath, dir],
      { encoding: 'utf8' },
    );
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
    const written = await readFile(join(dir, 'total.ts'), 'utf8');
    expect(written).toContain('return p + q;');
    expect(written).not.toContain('return a + b');
    expect(runTest(dir, 'total.test.ts').status).toBe(0);
  });
});
