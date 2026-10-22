import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { learningIssues, noteToRecord, type LearningRecord } from './continuous.js';
import { checkConstraints, enforceConstraints, extractConstraints } from './constraints.js';
import { applySkill, settleSkill, skillFromObservation } from './skills.js';

const MARKER = 'brq_';
const WRAP = 'brqWrap';
const RULE =
  'Retiens que, dans ce projet, chaque fonction exportée porte le préfixe brq_ et chaque return s’écrit return brqWrap( ... ). Une fonction sans ce préfixe ou sans brqWrap n’est pas acceptée.';

const TASKS = [
  'Écris le fichier qui expose une fonction pour additionner deux nombres.',
  'Un module doit renvoyer le double d’un entier. Donne uniquement le code du fichier.',
  'Il faut savoir si une liste de nombres ne contient rien. Code du module, sans commentaire.',
  'Prépare le fichier qui renvoie le dernier caractère d’un texte.',
  'Dans le module de caisse, calcule le produit de deux quantités. Réponds par le fichier complet.',
];

const PARTIAL = [
  'function add(a, b) { return brqWrap(a + b); }',
  'function doubleNumber(num) { return brqWrap(num * 2); }',
  'function brqIsEmpty(numbers) { return numbers.length === 0; }',
  'function getLastChar(str) { return str[str.length - 1]; }',
  'function brqQuantiteProduit(quantite1, quantite2) { return quantite1 * quantite2; }',
];

function ruleRecord(): LearningRecord {
  const record = noteToRecord({ id: 'regle-synthetique', text: RULE, now: 48 });
  if (!record) throw new Error('phrase non retenue');
  return record;
}

function fullRule(source: string): boolean {
  const names = [...source.matchAll(/function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1] ?? '');
  return (
    names.length > 0 &&
    names.every((name) => name.startsWith(MARKER)) &&
    /export\s+function\s+/.test(source) &&
    new RegExp(`return\\s+${WRAP}\\s*\\(`).test(source)
  );
}

describe('contrainte structurée', () => {
  it('ne grave pas la convention synthétique dans le moteur', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    for (const name of ['constraints.ts', 'continuous.ts', 'injection.ts', 'methods.ts', 'skills.ts']) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(text, name).not.toContain(MARKER);
      expect(text, name).not.toContain(WRAP);
    }
  });

  it('après un redémarrage des données, la règle complète est dans le résultat', () => {
    const stored = JSON.parse(JSON.stringify(ruleRecord())) as LearningRecord;
    expect(stored.type).toBe('preference');
    expect(stored.status).toBe('validated');
    const constraints = extractConstraints([stored]);
    expect(constraints.map((item) => item.verify).sort()).toEqual(['name-prefix', 'return-wrapper']);
    expect(constraints.every((item) => item.origin.recordId === stored.id)).toBe(true);
    expect(constraints.every((item) => item.preconditions.length > 0 && item.limits.length > 0)).toBe(true);
    for (const task of TASKS) {
      expect(task).not.toContain(MARKER);
      expect(task).not.toContain(WRAP);
    }
    for (const [index, source] of PARTIAL.entries()) {
      const checked = enforceConstraints(source, [stored]);
      expect(checked.ok, TASKS[index]).toBe(true);
      expect(fullRule(checked.source), checked.source).toBe(true);
      expect(checked.attempts.length).toBeGreaterThan(0);
      expect(checked.trace.map((line) => line.stage)).toEqual([
        'record',
        'retrieve',
        'prompt',
        'plan',
        'code',
        'apply',
        'verify',
      ]);
      expect(checked.trace.every((line) => !/api[_-]?key|Bearer /i.test(line.detail))).toBe(true);
    }
  });

  it('une mémoire vide ne fabrique pas la règle', () => {
    for (const source of PARTIAL) {
      const checked = enforceConstraints(source, []);
      expect(checked.source).toBe(source);
      expect(checked.changed).toBe(false);
      expect(fullRule(checked.source)).toBe(false);
    }
    const prose = enforceConstraints('Je ne sais pas.', [ruleRecord()], { requireFunction: true });
    expect(prose.source).toBe('Je ne sais pas.');
    expect(prose.ok).toBe(false);
    expect(prose.failed[0]?.message).toMatch(/aucune fonction/);
  });

  it('laisse un fichier déjà conforme et n’édite que la fonction en échec', () => {
    const held = 'export function brq_add(a, b) {\n  return brqWrap(a + b);\n}\n';
    const checked = enforceConstraints(held, [ruleRecord()]);
    expect(checked.source).toBe(held);
    expect(checked.changed).toBe(false);
    expect(checked.ok).toBe(true);
    const mixed = `${held}function total(a, b) {\n  return a - b;\n}\n`;
    const next = enforceConstraints(mixed, [ruleRecord()]);
    expect(next.ok).toBe(true);
    expect(next.source.startsWith(held)).toBe(true);
    expect(next.source).toContain('function brq_total');
    expect(next.source).toContain('return brqWrap(a - b)');
    expect(next.source).not.toContain('function total');
  });

  it('n’applique pas une règle ambiguë, contredite, limitée à un autre fichier, ou tirée d’un exemple', () => {
    const source = 'function total(a, b) {\n  return a - b;\n}\n';
    const hedge = noteToRecord({
      id: 'flou',
      text: 'Retiens que, peut-être, chaque fonction porte le préfixe zz_.',
      now: 1,
    })!;
    expect(extractConstraints([hedge])).toEqual([]);
    expect(enforceConstraints(source, [hedge]).source).toBe(source);
    const left = noteToRecord({
      id: 'aa',
      text: 'Retiens que chaque fonction porte le préfixe aa_.',
      now: 1,
    })!;
    const right = noteToRecord({
      id: 'bb',
      text: 'Retiens que chaque fonction porte le préfixe bb_.',
      now: 2,
    })!;
    expect(extractConstraints([left, right])).toEqual([]);
    expect(enforceConstraints(source, [left, right]).source).toBe(source);
    const local = noteToRecord({
      id: 'fichier',
      text: 'Retiens que, dans le fichier atelier.js, chaque fonction porte le préfixe qq_.',
      now: 3,
    })!;
    expect(enforceConstraints(source, [local], { path: 'src/quota.js' }).source).toBe(source);
    const renamed = enforceConstraints(source, [local], { path: 'atelier.js' });
    expect(renamed.source).toContain('function qq_total');
    const example: LearningRecord = {
      ...ruleRecord(),
      id: 'exemple',
      type: 'experience',
      origin: 'mission',
      hint: { from: 'return a - b;', to: 'return (a + b) * 3 + 1;', language: 'javascript' },
    };
    const pasted = enforceConstraints(source, [example]);
    expect(pasted.source).toBe(source);
    expect(pasted.source).not.toContain('(a + b) * 3 + 1');
    expect(extractConstraints([example])).toEqual([]);
  });

  it('nomme la contrainte rouge et s’arrête à la limite sans déclarer un succès', () => {
    const source = 'function add(a, b) { return a + b; }';
    const issues = learningIssues(source, [ruleRecord()]);
    expect(issues.some((issue) => issue.includes('name-prefix') || issue.includes(MARKER))).toBe(true);
    expect(learningIssues('bonjour', [ruleRecord()])).toEqual([]);
    const stopped = enforceConstraints(source, [ruleRecord()], { limit: 1 });
    expect(stopped.ok).toBe(false);
    expect(stopped.attempts).toHaveLength(1);
    expect(fullRule(stopped.source)).toBe(false);
    expect(checkConstraints(stopped.source, [ruleRecord()]).length).toBeGreaterThan(0);
  });
});

function runNode(cwd: string, file: string): { status: number | null } {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', file], {
    cwd,
    encoding: 'utf8',
  });
  return { status: result.status };
}

function spec(fn: string, body: string): string {
  return `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { ${fn} } from './${fn}.ts';\n${body}\n`;
}

function validatedSkill(id: string, before: string, after: string, origin: string, request: string, context: string) {
  const created = skillFromObservation({
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
  if (!created?.skill) throw new Error(id);
  return settleSkill(created, { ok: true, context, now: 3 });
}

const skillOptions = { language: 'typescript' as const, version: process.version, validatedOnly: true };

describe('projets indépendants, connaissances séparées de la règle', () => {
  const cases = [
    {
      id: 'logique',
      fn: 'ecart',
      source: 'export function ecart(p, q) {\n  return p - q;\n}\n',
      body: `test('normal', () => { assert.equal(ecart(2, 5), 7); });\ntest('zero', () => { assert.equal(ecart(0, 0), 0); });`,
      skill: () =>
        validatedSkill('align', 'return a * b;', 'return a + b;', 'projet-produit', 'addition', 'somme'),
      golden: 'return a + b',
    },
    {
      id: 'collection-vide',
      fn: 'moyenne',
      source:
        'export function moyenne(values) {\n  const total = values.reduce((s, n) => s + n, 0);\n  return total / values.length;\n}\n',
      body: `test('vide', () => { assert.equal(moyenne([]), 0); });\ntest('deux', () => { assert.equal(moyenne([2, 4]), 3); });`,
      skill: () =>
        validatedSkill(
          'vide',
          'return sum / items.length;',
          'return items.length === 0 ? 0 : sum / items.length;',
          'projet-moyenne',
          'une liste vide ne doit pas donner un nombre illisible',
          'autre-moyenne',
        ),
      golden: 'items.length === 0',
    },
    {
      id: 'analyse',
      fn: 'lire',
      source: 'export function lire(raw) {\n  return JSON.parse(raw);\n}\n',
      body: `test('objet', () => { assert.deepEqual(lire('{"ok":true}'), { ok: true }); });\ntest('illisible', () => { assert.equal(lire('non'), null); });`,
      skill: () =>
        validatedSkill(
          'parse',
          'return JSON.parse(text);',
          'try {\n  return JSON.parse(text);\n} catch {\n  return null;\n}',
          'projet-analyse',
          'un texte inutilisable ne doit pas lever',
          'autre-analyse',
        ),
      golden: 'JSON.parse(text)',
    },
    {
      id: 'type',
      fn: 'repeter',
      source: 'export function repeter(n) {\n  return n.repeat(2);\n}\n',
      body: `test('trois', () => { assert.equal(repeter(3), '33'); });\ntest('zero', () => { assert.equal(repeter(0), '00'); });`,
      skill: () =>
        validatedSkill(
          'texte',
          'return value.trim();',
          'return String(value).trim();',
          'projet-texte',
          'afficher le nombre',
          'autre-texte',
        ),
      golden: 'value.trim',
    },
  ] as const;

  it('avec une compétence retrouvée les tests passent, sans elle ils échouent', async () => {
    for (const item of cases) {
      const skill = item.skill();
      expect(JSON.stringify(skill)).not.toContain(item.golden);
      const bare = applySkill(item.source, spec(item.fn, item.body), [], skillOptions);
      expect(bare.used, item.id).toBe(false);
      expect(bare.source).toBe(item.source);
      const bareDir = await mkdtemp(join(tmpdir(), `jarvis-${item.id}-`));
      await writeFile(join(bareDir, `${item.fn}.ts`), bare.source);
      await writeFile(join(bareDir, `${item.fn}.test.ts`), spec(item.fn, item.body));
      expect(runNode(bareDir, `${item.fn}.test.ts`).status, item.id).not.toBe(0);

      const forced = enforceConstraints(item.source, [skill]);
      expect(forced.source, item.id).toBe(item.source);

      const skilled = applySkill(item.source, spec(item.fn, item.body), [skill], skillOptions);
      expect(skilled.used, item.id).toBe(true);
      expect(skilled.source, item.id).not.toContain(item.golden);
      const dir = await mkdtemp(join(tmpdir(), `jarvis-${item.id}-ok-`));
      await writeFile(join(dir, `${item.fn}.ts`), skilled.source);
      await writeFile(join(dir, `${item.fn}.test.ts`), spec(item.fn, item.body));
      expect(runNode(dir, `${item.fn}.test.ts`).status, `${item.id}\n${skilled.source}`).toBe(0);
    }
  });

  it('corrige le calcul sans réécrire la fonction déjà verte', async () => {
    const skill = validatedSkill('align-garde', 'return a * b;', 'return a + b;', 'projet-produit', 'addition', 'somme');
    const source = 'export function garde(n) {\n  return n + 1;\n}\nexport function total(a, b) {\n  return a - b;\n}\n';
    const body = `test('garde', () => { assert.equal(garde(1), 2); });
test('garde-encore', () => { assert.equal(garde(4), 5); });
test('total', () => { assert.equal(total(2, 5), 7); });
test('zero', () => { assert.equal(total(0, 0), 0); });`;
    const tests = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { garde, total } from './calc.ts';\n${body}\n`;
    const bare = applySkill(source, tests, [], skillOptions);
    expect(bare.source).toBe(source);
    const skilled = applySkill(source, tests, [skill], { ...skillOptions, query: 'corriger le calcul' });
    expect(skilled.used).toBe(true);
    expect(skilled.source).toContain('export function garde(n) {\n  return n + 1;\n}');
    expect(skilled.source).toContain('return a + b;');
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-garde-'));
    await writeFile(join(dir, 'calc.ts'), skilled.source);
    await writeFile(join(dir, 'calc.test.ts'), tests);
    expect(runNode(dir, 'calc.test.ts').status, await readFile(join(dir, 'calc.ts'), 'utf8')).toBe(0);
    const held = enforceConstraints(source, [skill]);
    expect(held.source).toBe(source);
  });
});
