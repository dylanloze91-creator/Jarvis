import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ASK_MARKER,
  PLAN_MARKER,
  REAL_BENCH_TASKS,
  type AskTask,
  type CompleteTask,
  type EditTask,
  type PlanTask,
  type ReviewTask,
} from '@jarvis/core';
import { createHarness } from '../controllerHarness.testkit.js';
import { FakeOllama, type ChatBody, type Reply } from './fakeOllama.testkit.js';

const realRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));
const base = mkdtempSync(join(tmpdir(), 'jarvis-banc-reel-'));
const repo = join(base, 'Jarvis');
const MODEL = 'scripte:banc-reel';
const fake = new FakeOllama();

function fixtureFromRealFiles(): void {
  const paths = new Set<string>(['CLAUDE.md']);
  for (const task of REAL_BENCH_TASKS) {
    if ('truth' in task) paths.add((task as AskTask | PlanTask | CompleteTask).truth.path);
    if (task.kind === 'review' || task.kind === 'edit')
      paths.add((task as ReviewTask | EditTask).source);
    if (task.kind === 'complete') for (const p of task.sources) paths.add(p);
  }
  for (const path of paths) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    copyFileSync(join(realRoot, path), join(repo, path));
  }
  writeFileSync(
    join(repo, 'package.json'),
    '{ "name": "jarvis", "version": "0.0.0", "private": true }\n',
  );
  mkdirSync(join(repo, 'apps/desktop'), { recursive: true });
  writeFileSync(
    join(repo, 'apps/desktop/package.json'),
    '{ "name": "@jarvis/desktop", "version": "0.5.1" }\n',
  );
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
  mkdirSync(join(repo, 'node_modules'), { recursive: true });
  symlinkSync(
    join(realRoot, 'node_modules', 'typescript'),
    join(repo, 'node_modules', 'typescript'),
    'dir',
  );
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/dylanloze91-creator/Jarvis.git');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'vrais fichiers');
}

/** Modèle scripté qui réussit chaque tâche du banc réel, avec de vrais appels d'outils. */
function script(body: ChatBody): Reply {
  const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
  const prompt = body.messages.find((m) => m.role === 'user')?.content ?? '';
  const done = body.messages.filter((m) => m.role === 'tool').length;
  if (system.includes(ASK_MARKER)) {
    const task = REAL_BENCH_TASKS.find(
      (t): t is AskTask => t.kind === 'ask' && prompt.includes(t.question),
    )!;
    if (done === 0)
      return { call: { name: 'dev_read_file', arguments: { path: task.truth.path } } };
    return {
      content: JSON.stringify({
        reponse: `packages/core — ${task.truth.path} : ${task.truth.contains}`,
        fichiers: [task.truth.path],
        citations: [{ chemin: task.truth.path, extrait: task.truth.contains }],
      }),
    };
  }
  if (system.includes(PLAN_MARKER)) {
    if (done === 0)
      return {
        call: { name: 'dev_read_file', arguments: { path: 'packages/core/src/settings.ts' } },
      };
    return {
      content: JSON.stringify({
        resume: 'Ajouter le réglage.',
        fichiers: [
          { chemin: 'packages/core/src/settings.ts', action: 'modifier', pourquoi: 'schéma' },
        ],
        tests: ['test-core'],
      }),
    };
  }
  if (prompt.startsWith('Relis ce diff'))
    return {
      content: prompt.includes('-  forceConfirm: true')
        ? '{"verdict": "refusé", "findings": [{"severity": "bloquant", "file": "apps/desktop/src/main/tools/shell.ts", "message": "confirmation retirée"}]}'
        : '{"verdict": "ok", "findings": []}',
    };
  if (prompt.startsWith('La vérification échoue')) {
    const steps = [
      { name: 'read_file', arguments: { path: 'src/repoCheck.ts' } },
      {
        name: 'edit_file',
        arguments: {
          path: 'src/repoCheck.ts',
          search: 'return diff < 0 ? 1 : -1;',
          replace: 'return diff < 0 ? -1 : 1;',
        },
      },
    ];
    return steps[done] ? { call: steps[done]! } : { content: 'Corrigé.' };
  }
  if (prompt.startsWith('Ajoute à src/repoCheck.ts')) {
    const edit = {
      name: 'edit_file',
      arguments: {
        path: 'src/repoCheck.ts',
        search: 'export function isJarvisRemote(',
        replace:
          'export function isSameRemote(a: string, b: string): boolean {\n  return normalizeRemote(a) === normalizeRemote(b);\n}\n\nexport function isJarvisRemote(',
      },
    };
    return done === 0 ? { call: edit } : { content: 'Ajouté.' };
  }
  if (prompt.includes('valeur de SANDBOX_MIN_FREE_BYTES'))
    return { content: 'Elle vaut 3e9 octets.' };
  if (prompt.includes('Explique en français'))
    return { content: 'La fonction compare deux numéros de version et renvoie -1, 0 ou 1.' };
  if (prompt.includes('Écris un test Vitest'))
    return {
      content:
        "describe('compareVersions', () => { it('ordonne', () => { expect(compareVersions('1.0.0', '1.0.1')).toBe(-1); expect(compareVersions('2.0.0', '1.0.0')).toBe(1); expect(compareVersions('v1.2.3', '1.2.3')).toBe(0); }); });",
    };
  if (prompt.includes('Page 1')) return { content: 'Google, sans clé (Page 2).' };
  return { content: 'Je ne sais pas.' };
}

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  fixtureFromRealFiles();
  await fake.start();
  fake.installed.set(MODEL, 3e9);
  fake.scripts.set(MODEL, script);
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

describe('banc réel sur le code de Jarvis (0.5.1)', () => {
  it('chaque tâche vérifiée par du code ; un score par rôle ; aucun modèle choisi ; copie intacte', async () => {
    const h = createHarness({ base, repo, fake, developer: {} });
    await h.instance.validate(repo);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const state = await h.instance.realBenchmark(MODEL);
    expect(state.task?.outcome, state.task?.message).toBe('success');
    const bench = state.model.realBenches.find((b) => b.model === MODEL)!;
    const failures = bench.tasks.filter((t) => t.ok !== true).map((t) => `${t.id} : ${t.detail}`);
    expect(failures).toEqual([]);
    expect(bench.commit).toBe(head);
    for (const role of bench.roles) {
      expect(role.measured, role.role).toBeGreaterThan(0);
      expect(role.score, role.role).toBe(1);
    }
    expect(h.settings.developer.codeModel).toBe('');
    expect(state.task?.message).toMatch(/Aucun modèle n’est choisi/);
    expect(fake.pulls).toEqual([]);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toBe(
      '',
    );
    expect(existsSync(join(repo, 'src'))).toBe(false);
  }, 180_000);

  it('un modèle qui se trompe : tâches ratées, rien de non mesurable caché', async () => {
    const WRONG = 'scripte:faux';
    fake.installed.set(WRONG, 3e9);
    fake.scripts.set(WRONG, () => ({
      content: '{"reponse": "Je pense que c’est ailleurs.", "fichiers": [], "citations": []}',
    }));
    const h = createHarness({ base, repo, fake, developer: {} });
    await h.instance.validate(repo);
    const state = await h.instance.realBenchmark(WRONG);
    const bench = state.model.realBenches.find((b) => b.model === WRONG)!;
    expect(bench.tasks.filter((t) => t.ok === true).map((t) => t.id)).toEqual([]);
    expect(bench.tasks.every((t) => t.ok !== null)).toBe(true);
    expect(bench.roles.find((r) => r.role === 'REASONER')?.score).toBe(0);
  }, 180_000);

  it('modèle absent d’Ollama : refusé, rien n’est téléchargé', async () => {
    const h = createHarness({ base, repo, fake, developer: {} });
    await h.instance.validate(repo);
    const state = await h.instance.realBenchmark('absent:modele');
    expect(state.notice).toMatch(/rien n’est téléchargé/);
    expect(fake.pulls).toEqual([]);
  });
});
