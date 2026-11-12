import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DESIGN_MARKER,
  EDIT_MARKER,
  FIX_MARKER,
  GOAL_MARKER,
  PLAN_MARKER,
  REVIEW_MARKER,
} from '@jarvis/core';
import { createHarness } from '../controllerHarness.testkit.js';
import { FakeOllama, type ChatBody, type Reply } from '../models/fakeOllama.testkit.js';
import { createFixtureRepo } from './taskWorkflow.testkit.js';

/**
 * 5.0.78 : mission « modifier » lancée en mode direct (sans carte pour le plan).
 * Cas réel du 12 novembre 2026 : le Codeur a écrit `src/rules.ts`, absent du plan,
 * sans carte, et le journal disait « Validé par le plan ». Désormais, un fichier
 * hors plan passe par une carte (refusée ici : rien n'est écrit), un fichier
 * protégé aussi, et « Validé par le plan » n'est inscrit que pour les fichiers du plan.
 */

const base = mkdtempSync(join(tmpdir(), 'jarvis-direct-'));
const jarvis = join(base, 'Jarvis');
const photos = join(base, 'photos');
const CODE = 'scripte:direct';
const fake = new FakeOllama();
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const system = (body: ChatBody) => body.messages.find((m) => m.role === 'system')?.content ?? '';

/** Plan : src/version.ts seulement. Modification : version.ts (plan), puis src/rules.ts (hors plan), puis package.json (protégé). */
function script(body: ChatBody): Reply {
  const text = system(body);
  const done = body.messages.filter((m) => m.role === 'tool').length;
  if (text.includes(GOAL_MARKER))
    return {
      content: JSON.stringify({
        goal: 'Une constante VERSION exportée.',
        questions: [],
        criteria: ['aucun nouvel échec'],
      }),
    };
  if (text.includes(DESIGN_MARKER))
    return {
      content: JSON.stringify({
        architecture: 'Un fichier src/version.ts.',
        modules: [{ name: 'version', files: ['src/version.ts'] }],
      }),
    };
  if (text.includes(REVIEW_MARKER)) return { content: '{"verdict": "ok", "issues": []}' };
  if (text.includes(PLAN_MARKER)) {
    if (done === 0) return { call: { name: 'dev_read_file', arguments: { path: 'src/index.ts' } } };
    return {
      content: JSON.stringify({
        resume: 'Ajouter la constante VERSION.',
        criteres: ['aucun nouvel échec'],
        fichiers: [{ chemin: 'src/version.ts', action: 'creer', pourquoi: 'constante' }],
        tests: ['typecheck', 'test'],
      }),
    };
  }
  if (text.includes(EDIT_MARKER)) {
    const steps = [
      {
        name: 'dev_create_file',
        arguments: { path: 'src/version.ts', content: 'export const VERSION = "1.0.0";\n' },
      },
      {
        name: 'dev_create_file',
        arguments: { path: 'src/rules.ts', content: 'export const KEYS = { pause: [" "] };\n' },
      },
      {
        name: 'dev_edit_file',
        arguments: {
          path: 'package.json',
          search: '"private": true',
          replace: '"private": true,\n  "description": "hors plan et protégé"',
        },
      },
    ];
    const next = steps[done];
    return next ? { call: next } : { content: 'Modifications faites.' };
  }
  if (text.includes(FIX_MARKER)) return { content: 'Rien à corriger.' };
  return { content: 'Je ne sais pas.' };
}

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(jarvis);
  createFixtureRepo(photos);
  const pkg = JSON.parse(readFileSync(join(photos, 'package.json'), 'utf8'));
  writeFileSync(
    join(photos, 'package.json'),
    `${JSON.stringify({ ...pkg, name: 'photos', description: 'Tri de photos' }, null, 2)}\n`,
  );
  git(
    photos,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qam',
    'nom',
  );
  await fake.start();
  fake.installed.set(CODE, 3e9);
  fake.scripts.set(CODE, script);
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

describe('mode direct : couverture du plan (5.0.78)', () => {
  it('fichier hors plan ou protégé : carte, refusée = rien d’écrit ; « Validé par le plan » seulement pour le plan', async () => {
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE },
      answer: (card) => !(card.toolName === 'dev_create_file' || card.toolName === 'dev_edit_file'),
    });
    await h.instance.validate(jarvis);
    await h.instance.importProject(photos);
    const done = await h.instance.startMission(
      'modify',
      'Ajoute une constante VERSION et exporte-la.',
      true,
      'photos',
    );
    const mission = done.mission!;
    const task = done.codeTask!;
    expect(task.worktreePath.startsWith(join(base, 'photos-taches'))).toBe(true);
    expect(task.plan?.files.map((f) => f.path)).toEqual(['src/version.ts']);

    // Le fichier du plan est écrit sans carte ; les deux autres ont eu une carte, refusée.
    expect(existsSync(join(task.worktreePath, 'src', 'version.ts'))).toBe(true);
    expect(existsSync(join(task.worktreePath, 'src', 'rules.ts'))).toBe(false);
    expect(readFileSync(join(task.worktreePath, 'package.json'), 'utf8')).not.toContain(
      'hors plan et protégé',
    );

    const fileCards = h.cards.filter(
      (c) => c.toolName === 'dev_create_file' || c.toolName === 'dev_edit_file',
    );
    expect(fileCards.map((c) => [c.toolName, c.reason])).toEqual([
      ['dev_create_file', 'fichier hors du plan validé'],
      ['dev_edit_file', 'dépendances et scripts npm'],
    ]);
    expect(fileCards[0]!.safety.level).toBe('confirm');
    expect(fileCards[0]!.diff?.some((d) => d.path === 'src/rules.ts')).toBe(true);
    expect(fileCards[1]!.safety.level).toBe('always-confirm');
    expect(h.cards.some((c) => c.toolName === 'dev_create_file' && c.command?.includes('version.ts'))).toBe(false);

    // Journal : « Validé par le plan » seulement pour src/version.ts ; la carte refusée est un refus.
    expect(task.planApproved.map((a) => a.target)).not.toContain('src/rules.ts');
    expect(task.planApproved.map((a) => a.target)).not.toContain('package.json');
    const mine = (await h.audit.list()).filter((e) => e.missionId === mission.id);
    const writes = mine.filter((e) => e.toolName === 'dev_create_file' || e.toolName === 'dev_edit_file');
    const byPath = (p: string) => writes.filter((e) => e.arguments?.path === p);
    expect(byPath('src/version.ts').map((e) => e.resultSummary)).toEqual([
      expect.stringContaining('Validé par le plan'),
    ]);
    for (const entry of [...byPath('src/rules.ts'), ...byPath('package.json')]) {
      expect(entry.decision).not.toBe('approved');
      expect(entry.resultSummary ?? '').not.toContain('Validé par le plan');
    }
    const tests = mine.filter((e) => e.toolName === 'dev_run_tests');
    expect(tests.length).toBeGreaterThan(0);
    for (const entry of tests) expect(entry.resultSummary ?? '').not.toContain('Validé par le plan');
    await h.instance.discardTask();
  }, 180_000);
});
