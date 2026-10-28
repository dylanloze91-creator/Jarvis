import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../developer/unifiedDiff.js';
import {
  applyExperienceToSource,
  applyIncoming,
  experienceFromMission,
  experienceReplacement,
  formatLearningContext,
  noteToRecord,
  relevantRecords,
  type LearningRecord,
} from './continuous.js';

/** `--experimental-strip-types` n'existe qu'à partir de Node 22.6 ; le projet accepte Node 20 (environmentCheck). */
const STRIP_TYPES = (() => {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 6);
})();

const REQUEST_A =
  'La fonction add multiplie au lieu d’additionner. Le test node echoue.';
const REQUEST_B =
  'La fonction total multiplie au lieu d’additionner. Le test node echoue.';

const BEFORE_ADD = `export function add(a: number, b: number): number {\n  return a * b;\n}\n`;
const AFTER_ADD = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
const BEFORE_TOTAL = `export function total(a: number, b: number): number {\n  return a * b;\n}\n`;

function testSource(fn: string, call: string, expected: number): string {
  return `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { ${fn} } from './${fn}.ts';\n\ntest('${fn} vaut ${expected}', () => {\n  assert.equal(${call}, ${expected});\n});\n`;
}

function runProjectTest(cwd: string, file: string): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', file],
    { cwd, encoding: 'utf8' },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  };
}

describe('expérience réutilisée sur un autre projet', () => {
  it.skipIf(!STRIP_TYPES)(
    'applique l’indice validé de A dans le fichier de B, et laisse B rouge sans mémoire',
    async () => {
      expect(REQUEST_B).not.toContain('a + b');
      expect(REQUEST_B).not.toContain('return a + b');

      const root = await mkdtemp(join(tmpdir(), 'jarvis-exp-'));
      const projectA = join(root, 'projet-a');
      const projectB = join(root, 'projet-b');
      const projectBEmpty = join(root, 'projet-b-vide');
      await mkdir(projectA, { recursive: true });
      await mkdir(projectB, { recursive: true });
      await mkdir(projectBEmpty, { recursive: true });
      await writeFile(join(projectA, 'add.ts'), BEFORE_ADD);
      await writeFile(join(projectA, 'add.test.ts'), testSource('add', 'add(2, 3)', 5));
      await writeFile(join(projectB, 'total.ts'), BEFORE_TOTAL);
      await writeFile(join(projectB, 'total.test.ts'), testSource('total', 'total(4, 5)', 9));
      await writeFile(join(projectBEmpty, 'total.ts'), BEFORE_TOTAL);
      await writeFile(join(projectBEmpty, 'total.test.ts'), testSource('total', 'total(4, 5)', 9));

      const redA = runProjectTest(projectA, 'add.test.ts');
      expect(redA.status).not.toBe(0);
      expect(redA.output).toMatch(/fail/i);

      const diff = parseUnifiedDiff(
        [
          'diff --git a/add.ts b/add.ts',
          '--- a/add.ts',
          '+++ b/add.ts',
          '@@ -1,3 +1,3 @@',
          ' export function add(a: number, b: number): number {',
          '-  return a * b;',
          '+  return a + b;',
          ' }',
          '',
        ].join('\n'),
      );
      const replacement = experienceReplacement(diff);
      expect(replacement).toMatchObject({ from: 'return a * b;', to: 'return a + b;' });
      expect(replacement?.language).toBe('typescript');
      expect(
        experienceReplacement([
          {
            path: 'add.ts',
            hunks: [
              {
                lines: [
                  { kind: 'del', text: 'export function add(a: number, b: number): number {' },
                  { kind: 'add', text: 'export function sum(a: number, b: number): number {' },
                ],
              },
            ],
          },
        ]),
      ).toBeNull();

      await writeFile(join(projectA, 'add.ts'), AFTER_ADD);
      const greenA = runProjectTest(projectA, 'add.test.ts');
      expect(greenA.status).toBe(0);
      expect(greenA.output).toMatch(/# pass 1/);

      const input = {
        id: 'fix-add',
        now: 41,
        request: REQUEST_A,
        errorSignature: 'node:test add(2, 3) vaut 5 AssertionError',
        cause: 'la fonction multiplie au lieu d’additionner',
        fix: 'Indice : dans le fichier de ce projet, remplacer la ligne fautive. Ne pas recopier l’ancien fichier.',
        testCommands: ['node --experimental-strip-types --test add.test.ts'],
        beforeResult: 'not ok',
        afterResult: '# pass 1',
        files: ['add.ts'],
        hint: replacement ?? undefined,
      };
      expect(experienceFromMission({ ...input, ok: false })).toBeNull();
      const saved = experienceFromMission({ ...input, ok: true });
      expect(saved?.status).toBe('validated');
      expect(saved?.hint).toMatchObject({ from: 'return a * b;', to: 'return a + b;' });
      expect(saved?.trace?.outcome).toBe('passed');
      expect(saved?.fix).not.toContain('function add');

      const stronger = noteToRecord({
        id: 'deja',
        text: 'Non, la fonction multiplie au lieu d’additionner dans le test node.',
        now: 1,
      })!;
      const stored = applyIncoming([stronger], saved).records;
      expect(stored.find((item) => item.id === 'fix-add')?.status).toBe('validated');
      const refused = applyIncoming(stored, experienceFromMission({ ...input, ok: false }));
      expect(refused.action).toBe('ignored');
      expect(refused.records.filter((item) => item.type === 'experience')).toHaveLength(1);

      const storePath = join(root, 'learning.json');
      await writeFile(storePath, JSON.stringify(refused.records));
      const restarted = JSON.parse(await readFile(storePath, 'utf8')) as LearningRecord[];
      const hits = relevantRecords(restarted, REQUEST_B);
      const card = hits.find((item) => item.id === 'fix-add');
      expect(card?.status).toBe('validated');
      expect(card?.hint).toMatchObject({ from: 'return a * b;', to: 'return a + b;' });
      expect(formatLearningContext(card ? [card] : [])).toContain('return a + b');
      expect(formatLearningContext(card ? [card] : [])).toMatch(/sans recopier/);

      const candidate = { ...saved!, id: 'candidat', status: 'candidate' as const };
      expect(relevantRecords([candidate], REQUEST_B)).toEqual([]);
      expect(applyExperienceToSource(BEFORE_TOTAL, [candidate]).applied).toBe(false);

      const withMemory = applyExperienceToSource(BEFORE_TOTAL, card ? [card] : []);
      expect(withMemory.applied).toBe(true);
      expect(withMemory.source).toContain('function total');
      expect(withMemory.source).toContain('return a + b;');
      expect(withMemory.source).not.toContain('function add');
      const ambiguous = `${BEFORE_TOTAL}\nexport function extra(a: number, b: number): number {\n  return a * b;\n}\n`;
      expect(applyExperienceToSource(ambiguous, hits).applied).toBe(false);

      await writeFile(join(projectB, 'total.ts'), withMemory.source);
      const greenB = runProjectTest(projectB, 'total.test.ts');
      expect(greenB.status, greenB.output).toBe(0);
      expect(greenB.output).toMatch(/# pass 1/);
      expect(await readFile(join(projectB, 'total.ts'), 'utf8')).toBe(withMemory.source);

      const withoutMemory = applyExperienceToSource(BEFORE_TOTAL, []);
      expect(withoutMemory.applied).toBe(false);
      expect(withoutMemory.source).toContain('return a * b;');
      expect(withoutMemory.source).not.toContain('return a + b;');
      await writeFile(join(projectBEmpty, 'total.ts'), withoutMemory.source);
      const redB = runProjectTest(projectBEmpty, 'total.test.ts');
      expect(redB.status).not.toBe(0);
      expect(redB.output).toMatch(/fail/i);
      expect(await readFile(join(projectBEmpty, 'total.ts'), 'utf8')).toContain('return a * b;');
    },
    30_000,
  );
});
