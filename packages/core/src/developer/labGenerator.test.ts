import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptExercise,
  generateExercise,
  generatorPrompt,
  parseExercise,
  repairable,
  seedFor,
  type GeneratorSeed,
  type TeacherModel,
} from './labGenerator.js';
import { LAB_SYSTEM_PROMPT, labFirstPrompt } from './labRunner.js';

let work = '';
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'jarvis-gen-test-'));
});
afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

const SEED: GeneratorSeed = { level: 1, category: 'strings', theme: 'parking' };

function exercise(parts: {
  goal?: string;
  starter?: string;
  test?: string;
  solution?: string;
  name?: string;
  extra?: string;
}): string {
  const name = parts.name ?? 'plateLabel';
  return [
    '@@ OBJECTIF',
    parts.goal ??
      `${name}(plate) met la plaque d’immatriculation en majuscules et remplace les espaces par des tirets. Une plaque vide rend une chaîne vide.`,
    '@@ CONTRAINTES',
    `- Ne change pas le nom ${name}.`,
    '@@ CRITÈRES',
    '- Les minuscules deviennent des majuscules.',
    '- Les espaces deviennent des tirets.',
    `@@ DEPART src/${name}.mjs`,
    '```javascript',
    parts.starter ?? `export function ${name}(plate) {\n  return plate;\n}`,
    '```',
    `@@ TEST hidden/${name}.test.mjs`,
    parts.test ??
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        `import { ${name} } from '../src/${name}.mjs';`,
        `test('majuscules', () => assert.equal(${name}('ab 123 cd'), 'AB-123-CD'));`,
        `test('vide', () => assert.equal(${name}(''), ''));`,
        `test('déjà propre', () => assert.equal(${name}('XY-1'), 'XY-1'));`,
      ].join('\n'),
    `@@ SOLUTION src/${name}.mjs`,
    parts.solution ?? `export function ${name}(plate) {\n  return plate.toUpperCase().replace(/ /g, '-');\n}`,
    parts.extra ?? '',
    '@@ FIN',
  ].join('\n');
}

async function accept(text: string, accepted: Parameters<typeof acceptExercise>[0]['accepted'] = []) {
  return acceptExercise({ text, seed: SEED, model: 'prof', accepted, workParent: work, now: new Date('2026-10-28T00:00:00Z') });
}

describe('générateur d’exercices', () => {
  it('lit le format à balises, avec blocs de code et accents dans les titres', () => {
    const parsed = parseExercise(`Voici :\n${exercise({})}`);
    expect(parsed.goal).toMatch(/^plateLabel\(plate\)/);
    expect(parsed.criteria).toEqual(['Les minuscules deviennent des majuscules.', 'Les espaces deviennent des tirets.']);
    expect(parsed.starters).toEqual([{ path: 'src/plateLabel.mjs', content: 'export function plateLabel(plate) {\n  return plate;\n}\n' }]);
    expect(parsed.test?.path).toBe('hidden/plateLabel.test.mjs');
    expect(parsed.solutions[0]?.content).toMatch(/toUpperCase/);
  });

  it('accepte un exercice valide et en fait un exemple : consigne du professeur, write_file de sa solution', async () => {
    const outcome = await accept(exercise({}));
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;
    const { mission } = outcome.exercise;
    expect(mission.id).toMatch(/^g1-plate-label-[a-z0-9]{6}$/);
    expect(mission.split).toBe('development');
    expect(outcome.example.messages[0]).toEqual({ role: 'system', content: LAB_SYSTEM_PROMPT });
    expect(outcome.example.messages[1].content).toBe(labFirstPrompt(mission));
    expect(outcome.example.messages[1].content).not.toMatch(/toUpperCase|assert/);
    expect(outcome.example.messages[2].tool_calls[0]?.function.arguments.path).toBe('src/plateLabel.mjs');
    expect(outcome.example.meta).toMatchObject({ source: 'generated', model: 'prof', level: 1 });
  });

  it('refuse un départ déjà juste', async () => {
    const outcome = await accept(exercise({ starter: "export function plateLabel(plate) {\n  return plate.toUpperCase().replace(/ /g, '-');\n}", solution: "export function plateLabel(plate) {\n  return plate.toUpperCase().split(' ').join('-');\n}" }));
    expect(outcome).toMatchObject({ ok: false, reason: 'les tests passent déjà sur le départ' });
  });

  it('refuse une solution qui ne passe pas ses tests', async () => {
    const outcome = await accept(exercise({ solution: 'export function plateLabel(plate) {\n  return plate.toUpperCase();\n}' }));
    expect(outcome).toMatchObject({ ok: false, reason: 'la solution ne passe pas ses propres tests' });
  });

  it('refuse un départ illisible (erreur de syntaxe)', async () => {
    const outcome = await accept(exercise({ starter: 'export function plateLabel(plate) {\n  return plate +;\n}' }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/départ illisible|tests cassés/);
  });

  it('refuse le réseau, le hasard, l’heure courante et les imports hors de la liste', async () => {
    const network = await accept(exercise({ solution: "export function plateLabel(plate) {\n  fetch('http://x');\n  return plate.toUpperCase().replace(/ /g, '-');\n}" }));
    expect(network).toMatchObject({ ok: false, reason: 'réseau dans src/plateLabel.mjs' });
    const random = await accept(exercise({ extra: '' , solution: "export function plateLabel(plate) {\n  return Math.random() > 2 ? '' : plate.toUpperCase().replace(/ /g, '-');\n}" }));
    expect(random).toMatchObject({ ok: false, reason: 'hasard dans src/plateLabel.mjs' });
    const lodash = await accept(exercise({ solution: "import _ from 'lodash';\nexport function plateLabel(plate) {\n  return plate.toUpperCase().replace(/ /g, '-');\n}" }));
    expect(lodash).toMatchObject({ ok: false, reason: 'import refusé dans src/plateLabel.mjs : lodash' });
  });

  it('refuse un exercice qui reprend un nom de fonction des missions d’évaluation', async () => {
    const outcome = await accept(
      exercise({
        name: 'median',
        goal: 'median(nums) rend la valeur centrale des durées de stationnement triées, ou null pour une liste vide.',
        starter: 'export function median(nums) {\n  return null;\n}',
        test: "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { median } from '../src/median.mjs';\ntest('a', () => assert.equal(median([3, 1, 2]), 2));\ntest('b', () => assert.equal(median([1]), 1));\ntest('c', () => assert.equal(median([5, 9, 7]), 7));",
        solution: 'export function median(nums) {\n  if (!nums.length) return null;\n  const s = [...nums].sort((a, b) => a - b);\n  return s[s.length >> 1];\n}',
      }),
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'nom median déjà utilisé par l’évaluation' });
  });

  it('refuse un doublon d’un exercice déjà accepté', async () => {
    const first = await accept(exercise({}));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = await accept(exercise({ test: exercise({}).split('@@ TEST hidden/plateLabel.test.mjs\n')[1]!.split('\n@@ SOLUTION')[0] + "\ntest('autre', () => assert.equal(plateLabel('a b'), 'A-B'));" }), [first.exercise.mission]);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toMatch(/^doublon de g1-plate-label-/);
  });

  it('refuse une forme incomplète : pas de tests, chemin hors de src, trop peu d’assertions', async () => {
    expect(await accept('@@ OBJECTIF\nFaire quelque chose de précis et utile.\n@@ FIN')).toMatchObject({ ok: false });
    expect(await accept(exercise({}).replace(/src\/plateLabel\.mjs/g, 'lib/plateLabel.mjs'))).toMatchObject({ ok: false, reason: 'chemin de départ refusé : lib/plateLabel.mjs' });
    const weak = exercise({ test: "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { plateLabel } from '../src/plateLabel.mjs';\ntest('un', () => assert.equal(plateLabel('a'), 'A'));" });
    expect(await accept(weak)).toMatchObject({ ok: false, reason: 'moins de trois assertions' });
  });

  it('niveau 3 : correction sur deux fichiers avec non-régression', async () => {
    const text = [
      '@@ OBJECTIF',
      'rentalPrice(hours) du loueur de vélos doit facturer hourlyRate(hours) multiplié par le nombre d’heures, plafonné à 40. hourlyRate est juste et ne change pas.',
      '@@ CONTRAINTES',
      '- hourlyRate ne change pas.',
      '@@ CRITERES',
      '- Le plafond de 40 est appliqué.',
      '@@ DEPART src/rate.mjs',
      'export function hourlyRate(hours) {\n  return hours >= 5 ? 4 : 6;\n}',
      '@@ DEPART src/rental.mjs',
      "import { hourlyRate } from './rate.mjs';\nexport function rentalPrice(hours) {\n  return hourlyRate(hours) + hours;\n}",
      '@@ TEST hidden/rental.test.mjs',
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { hourlyRate } from '../src/rate.mjs';\nimport { rentalPrice } from '../src/rental.mjs';\ntest('taux', () => assert.equal(hourlyRate(2), 6));\ntest('court', () => assert.equal(rentalPrice(2), 12));\ntest('plafond', () => assert.equal(rentalPrice(20), 40));",
      '@@ SOLUTION src/rental.mjs',
      "import { hourlyRate } from './rate.mjs';\nexport function rentalPrice(hours) {\n  return Math.min(40, hourlyRate(hours) * hours);\n}",
      '@@ FIN',
    ].join('\n');
    const outcome = await acceptExercise({ text, seed: { level: 3, category: 'regression', theme: 'location de vélos' }, model: 'prof', accepted: [], workParent: work });
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (outcome.ok) expect(outcome.example.messages[2].tool_calls.map((call) => call.function.arguments.path)).toEqual(['src/rental.mjs']);
  });

  it('appelle le professeur avec la graine, les noms à éviter, et range l’erreur du modèle comme un rejet', async () => {
    const prompts: string[] = [];
    const teacher: TeacherModel = {
      name: 'prof',
      async complete({ prompt }) {
        prompts.push(prompt);
        return exercise({});
      },
    };
    const ok = await generateExercise({ teacher, seed: SEED, accepted: [], workParent: work });
    expect(ok.ok).toBe(true);
    expect(prompts[0]).toBe(generatorPrompt(SEED, []));
    const broken: TeacherModel = { name: 'prof', complete: async () => { throw new Error('Ollama injoignable'); } };
    expect(await generateExercise({ teacher: broken, seed: SEED, accepted: [], workParent: work })).toMatchObject({ ok: false, reason: 'erreur du modèle : Ollama injoignable' });
  });

  it('le niveau suit ce qui a été produit : un seul fichier ne passe jamais pour un niveau 3', async () => {
    const outcome = await acceptExercise({ text: exercise({ name: 'gateCode' }), seed: { level: 3, category: 'strings', theme: 'parking' }, model: 'prof', accepted: [], workParent: work });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.exercise.mission).toMatchObject({ level: 2, difficulty: 2 });
  });

  it('5.0.57 : .js devient .mjs (chemins et imports), l’exercice est accepté', async () => {
    const text = exercise({ name: 'ticketTag' }).replace(/src\/ticketTag\.mjs/g, 'src/ticketTag.js').replace("'../src/ticketTag.js'", "'../src/ticketTag.js'");
    expect(text).toContain('@@ DEPART src/ticketTag.js');
    const outcome = await accept(text);
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (outcome.ok) {
      expect(outcome.exercise.mission.starterFiles[0]?.path).toBe('src/ticketTag.mjs');
      expect(outcome.exercise.mission.hiddenTests[0]?.content).toContain("from '../src/ticketTag.mjs'");
    }
  });

  it('5.0.57 : un refus à l’exécution porte la sortie des tests', async () => {
    const outcome = await accept(exercise({ name: 'laneCode', solution: 'export function laneCode(plate) {\n  return plate.toUpperCase();\n}' }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('la solution ne passe pas ses propres tests');
      expect(outcome.detail).toMatch(/not ok|AssertionError|fail/i);
      expect(outcome.detail).not.toContain(work);
    }
  });

  it('5.0.57 : seconde chance — l’erreur exacte est renvoyée au professeur, qui corrige', async () => {
    const calls: { prompt: string; history?: readonly { role: string; content: string }[] }[] = [];
    const wrong = exercise({ name: 'dockCode', solution: 'export function dockCode(plate) {\n  return plate.toUpperCase();\n}' });
    const right = exercise({ name: 'dockCode' });
    const teacher: TeacherModel = {
      name: 'prof',
      async complete({ prompt, history }) {
        calls.push({ prompt, ...(history ? { history } : {}) });
        return calls.length === 1 ? wrong : right;
      },
    };
    const outcome = await generateExercise({ teacher, seed: SEED, accepted: [], workParent: work });
    expect(outcome).toMatchObject({ ok: true, repaired: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain('la solution ne passe pas ses propres tests');
    expect(calls[1]!.prompt).toContain('Sortie des tests');
    expect(calls[1]!.history).toEqual([
      { role: 'user', content: calls[0]!.prompt },
      { role: 'assistant', content: wrong },
    ]);
  });

  it('5.0.57 : seconde chance ratée → refus avec la première raison ; pas de seconde chance pour un doublon ni avec --no-repair', async () => {
    const same = exercise({ name: 'kioskCode', solution: 'export function kioskCode(plate) {\n  return plate;\n}' });
    let n = 0;
    const stubborn: TeacherModel = { name: 'prof', complete: async () => ((n += 1), same) };
    const failed = await generateExercise({ teacher: stubborn, seed: SEED, accepted: [], workParent: work });
    expect(failed).toMatchObject({ ok: false, reason: 'la solution est identique au départ', firstReason: 'la solution est identique au départ', firstRaw: same });
    expect(n).toBe(2);
    n = 0;
    await generateExercise({ teacher: stubborn, seed: SEED, accepted: [], workParent: work, repair: false });
    expect(n).toBe(1);
    expect(repairable('doublon de g1-x-abcdef')).toBe(false);
    expect(repairable('nom median déjà utilisé par l’évaluation')).toBe(false);
    expect(repairable('la solution ne passe pas ses propres tests')).toBe(true);
    expect(repairable('chemin de départ refusé : lib/x.mjs')).toBe(true);
  });

  it('les graines varient niveau, domaine et thème', () => {
    const seeds = Array.from({ length: 60 }, (_, i) => seedFor(i, 3));
    expect(new Set(seeds.map((s) => s.category)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(seeds.map((s) => s.level))).toEqual(new Set([1, 2, 3]));
    expect(new Set(seeds.map((s) => s.theme)).size).toBeGreaterThanOrEqual(20);
  });
});
