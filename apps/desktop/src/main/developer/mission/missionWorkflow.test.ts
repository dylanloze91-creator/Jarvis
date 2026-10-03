import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ASK_MARKER,
  DESIGN_MARKER,
  DIAGNOSE_MARKER,
  GOAL_MARKER,
  REVIEW_MARKER,
} from '@jarvis/core';
import { createHarness } from '../controllerHarness.testkit.js';
import { FakeOllama, type ChatBody, type Reply } from '../models/fakeOllama.testkit.js';
import { createFixtureRepo, taskScript } from '../task/taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-mission-'));
const repo = join(base, 'Jarvis');
const CODE = 'scripte:code';
const REV = 'scripte:relecteur';
const fake = new FakeOllama();
let reviews = 0;
let askQuestions = true;

const loop = taskScript();
function script(body: ChatBody): Reply {
  const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
  const done = body.messages.filter((m) => m.role === 'tool').length;
  if (system.includes(GOAL_MARKER))
    return {
      content: JSON.stringify({
        goal: 'Une constante VERSION exportée par src/index.ts.',
        questions: askQuestions ? ['Quelle valeur pour VERSION ?'] : [],
        criteria: ['les tests ne montrent aucun nouvel échec'],
      }),
    };
  if (system.includes(DESIGN_MARKER)) {
    if (done === 0) return { call: { name: 'dev_read_file', arguments: { path: 'src/index.ts' } } };
    return {
      content: JSON.stringify({
        architecture: 'Un fichier src/version.ts, réexporté par src/index.ts.',
        modules: [{ name: 'version', responsibility: 'constante', files: ['src/version.ts'] }],
        technologies: [{ name: 'TypeScript', reason: 'déjà utilisé', local: true }],
        risks: [],
      }),
    };
  }
  if (system.includes(DIAGNOSE_MARKER)) {
    if (done === 0)
      return { call: { name: 'dev_read_file', arguments: { path: 'src/version.ts' } } };
    return {
      content: JSON.stringify({
        hypotheses: [
          { cause: 'marqueur TYPE_ERROR laissé', file: 'src/version.ts', fix: 'le retirer' },
        ],
      }),
    };
  }
  if (system.includes(REVIEW_MARKER)) {
    reviews += 1;
    return {
      content:
        reviews === 1
          ? '{"verdict": "à revoir", "issues": [{"severity": "bloquant", "file": "src/version.ts", "message": "appel réseau non demandé"}]}'
          : '{"verdict": "ok", "issues": [{"severity": "info", "message": "rien à signaler"}]}',
    };
  }
  if (system.includes(ASK_MARKER)) {
    if (done === 0) return { call: { name: 'dev_read_file', arguments: { path: 'src/index.ts' } } };
    return {
      content: JSON.stringify({
        reponse: 'src/index.ts exporte un module vide.',
        fichiers: ['src/index.ts'],
        citations: [{ chemin: 'src/index.ts', extrait: 'export {};' }],
      }),
    };
  }
  return loop(body);
}

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(repo);
  await fake.start();
  fake.installed.set(CODE, 3e9);
  fake.installed.set(REV, 3e9);
  fake.scripts.set(CODE, script);
  fake.scripts.set(REV, script);
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

describe('missions sur Jarvis (0.5.2)', () => {
  it('modifier : questions → réponses → conception → plan → tests → diagnostic → correction → revue bloquante → correction → revue ok', async () => {
    const h = createHarness({
      base,
      repo,
      fake,
      developer: { codeModel: CODE, roleModels: { REVIEWER: REV } },
    });
    await h.instance.validate(repo);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    const asked = await h.instance.startMission(
      'modify',
      'Ajoute une constante VERSION et exporte-la.',
      false,
    );
    const waiting = asked.mission!;
    expect(waiting.status).toBe('waiting-answers');
    expect(waiting.goal?.questions).toEqual(['Quelle valeur pour VERSION ?']);
    expect(waiting.steps.find((s) => s.id === 'goal')).toMatchObject({
      status: 'waiting',
      model: CODE,
    });

    const done = await h.instance.answerMission(['1.0.0']);
    const mission = done.mission!;
    expect(mission.status, mission.summary ?? '').toBe('finished');
    expect(mission.verdict).toBe('success');
    expect(mission.answers).toEqual([
      { question: 'Quelle valeur pour VERSION ?', answer: '1.0.0' },
    ]);

    const steps = mission.steps.map((s) => `${s.id}:${s.actor}:${s.status}`);
    expect(steps).toEqual([
      'goal:REASONER:done',
      'design:ARCHITECT:done',
      'plan-1:CODER:done',
      'test-1:TESTER:done',
      'edit-1:CODER:done',
      'test-2:TESTER:done',
      'diagnose-1:DEBUGGER:done',
      'fix-1:CODER:done',
      'test-3:TESTER:done',
      'review-1:REVIEWER:failed',
      'diagnose-2:DEBUGGER:done',
      'fix-2:CODER:done',
      'test-4:TESTER:done',
      'review-2:REVIEWER:done',
    ]);
    const byId = Object.fromEntries(mission.steps.map((s) => [s.id, s]));
    expect(byId['design']!.output).toMatchObject({
      architecture: expect.stringContaining('src/version.ts'),
    });
    expect(byId['design']!.files).toEqual(['src/index.ts']);
    expect(byId['review-2']!.model).toBe(REV);
    expect(byId['fix-1']!.model).toBe(CODE);
    expect(byId['test-1']!.model).toBeUndefined();
    expect(byId['diagnose-1']!.files).toEqual(['src/version.ts']);

    const task = done.codeTask!;
    expect(task.model).toBe(CODE);
    expect(task.attempts).toBe(2);
    expect(task.review).toMatchObject({ model: REV, blocking: [] });
    expect(task.report?.markdown).toContain('### Revue (REVIEWER)');

    expect(fake.unloaded).toEqual(expect.arrayContaining([CODE, REV]));

    const audited = await h.audit.list();
    const mine = audited.filter((e) => e.missionId === mission.id);
    expect(mine.every((e) => e.projectId === 'jarvis')).toBe(true);
    const roleOf = (tool: string) =>
      new Set(mine.filter((e) => e.toolName === tool).map((e) => e.role));
    expect(roleOf('dev_run_tests')).toEqual(new Set(['TESTER']));
    expect(roleOf('dev_create_file')).toEqual(new Set(['CODER']));
    expect([...roleOf('dev_read_file')]).toEqual(expect.arrayContaining(['ARCHITECT', 'DEBUGGER']));

    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()).toBe(
      head,
    );
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toBe(
      '',
    );

    const restarted = createHarness({ base, repo, fake, developer: { codeModel: CODE } });
    const listed = await restarted.instance.listMissions();
    expect(listed.missions?.[0]).toMatchObject({
      id: mission.id,
      verdict: 'success',
      status: 'finished',
    });
    const reopened = await restarted.instance.openMission(mission.id);
    expect(reopened.mission?.steps).toHaveLength(14);
    await h.instance.discardTask();
  }, 180_000);

  it('question : réponse du REASONER, citation relue, sans copie isolée', async () => {
    const h = createHarness({ base, repo, fake, developer: { codeModel: CODE } });
    await h.instance.validate(repo);
    const state = await h.instance.startMission('question', 'Que contient src/index.ts ?', false);
    expect(state.mission).toMatchObject({
      status: 'finished',
      verdict: 'success',
      kind: 'question',
    });
    expect(state.mission?.steps[0]).toMatchObject({
      actor: 'REASONER',
      model: CODE,
      status: 'done',
    });
    expect(state.codeTask).toBeNull();
  }, 60_000);

  it('sans questions demandé : aucune attente, et aucun modèle = mission refusée', async () => {
    askQuestions = true;
    const none = createHarness({ base, repo, fake, developer: { codeModel: '' } });
    await none.instance.validate(repo);
    const refused = await none.instance.startMission(
      'modify',
      'Ajoute une constante VERSION.',
      true,
    );
    expect(refused.notice).toMatch(/Aucun modèle pour/);
    expect(refused.mission).toBeNull();
  });
});
