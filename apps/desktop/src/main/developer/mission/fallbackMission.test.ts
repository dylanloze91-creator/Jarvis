import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FACTORY_MARKER,
  GOAL_MARKER,
  JARVIS_PROJECT_PROFILE,
  NEW_PROJECT_CONTEXT,
  PLAN_MARKER,
  REVIEW_MARKER,
  STEP_LIMITS,
  WRITE_MARKER,
} from '@jarvis/core';
import { createHarness, fakeOutcome } from '../controllerHarness.testkit.js';
import { FakeOllama, type ChatBody, type Reply } from '../models/fakeOllama.testkit.js';
import { codeBlock, createFixtureRepo, writeRequest } from '../task/taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-secours-'));
const repo = join(base, 'Jarvis');
const projectsRoot = join(base, 'Projets');
const MODEL = 'petit:bavard';
const fake = new FakeOllama();
const system = (body: ChatBody) => body.messages.find((m) => m.role === 'system')?.content ?? '';
const RAMBLE = 'Pour bien faire, je vais d’abord réfléchir à chaque détail de la demande. '.repeat(
  30,
);

const GAME = `export interface GameState { width: number; height: number; ballX: number; ballY: number; vx: number; vy: number; left: number; right: number; }
export interface Input { keys: ReadonlySet<string> }
export function createGame(width: number, height: number): GameState {
  return { width, height, ballX: width / 2, ballY: height / 2, vx: 200, vy: 120, left: 0, right: 0 };
}
export function update(s: GameState, _input: Input, dt: number): GameState {
  let { ballX, ballY, vx, vy, left, right } = s;
  ballX += vx * dt;
  ballY += vy * dt;
  if (ballY < 0 || ballY > s.height) vy = -vy;
  if (ballX < 0) { right += 1; ballX = s.width / 2; }
  if (ballX > s.width) { left += 1; ballX = s.width / 2; }
  return { ...s, ballX, ballY, vx, vy, left, right };
}
export function render(ctx: CanvasRenderingContext2D, s: GameState): void {
  ctx.fillRect(s.ballX, s.ballY, 8, 8);
}
`;

/** Modèle qui ne rend jamais de JSON : objectif, gabarit, plan et revue partent en secours. */
function chatty(body: ChatBody): Reply {
  const text = system(body);
  if (text.includes(WRITE_MARKER) && writeRequest(body)?.path === 'src/game.ts')
    return codeBlock(GAME);
  if (
    text.includes(GOAL_MARKER) ||
    text.includes(FACTORY_MARKER) ||
    text.includes(PLAN_MARKER) ||
    text.includes(REVIEW_MARKER)
  )
    return { content: RAMBLE };
  return { content: RAMBLE };
}

function offlineNpm(spec: { cwd: string }, display: string) {
  if (!existsSync(join(spec.cwd, 'src', 'main.ts'))) return null;
  if (display.startsWith('npm install')) {
    writeFileSync(join(spec.cwd, 'package-lock.json'), '{"lockfileVersion": 3, "packages": {}}\n');
    return fakeOutcome(display);
  }
  if (display.startsWith('npm ci') || display === 'npm run typecheck') return fakeOutcome(display);
  if (display === 'npm test') return fakeOutcome(display, '      Tests  2 passed (2)\n');
  return null;
}

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(repo);
  await fake.start();
  fake.installed.set(MODEL, 2e9);
  fake.scripts.set(MODEL, chatty);
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

const bodies = () =>
  fake.requests
    .filter((r) => r.path === '/api/chat')
    .map((r) => r.body as ChatBody & { options?: { num_predict?: number } });

describe('mission avec un petit modèle bavard (5.0.1)', () => {
  it('« crée un Pong » : objectif, gabarit et plan de secours, création, code écrit, tests, revue non bloquante', async () => {
    const h = createHarness({
      base,
      repo,
      fake,
      developer: { codeModel: MODEL, projectsRoot },
      intercept: offlineNpm,
    });
    await h.instance.validate(repo);
    const done = await h.instance.startMission(
      'new-project',
      'Crée un Pong jouable dans le navigateur : deux raquettes, une balle, le score.',
      true,
    );
    const mission = done.mission!;
    expect(mission.status, mission.summary ?? '').toBe('finished');
    const byId = Object.fromEntries(mission.steps.map((s) => [s.id, s]));
    expect(byId['goal']).toMatchObject({ status: 'done' });
    expect(byId['goal']!.detail).toMatch(/^objectif de secours, tiré de ta demande/);
    expect(mission.goal?.goal).toMatch(/^Crée un Pong jouable/);
    expect(byId['design']!.detail).toMatch(
      /^choix de secours, par règles fixes : Jeu dans le navigateur/,
    );
    expect(byId['create']).toMatchObject({ status: 'done' });
    expect(mission.projectId).toBe('pong');
    expect(h.cards.some((c) => c.toolName === 'dev_create_project')).toBe(true);

    const task = done.codeTask!;
    expect(task.planFallback).toMatch(/^plan de secours/);
    expect(task.plan?.files.map((f) => f.path)).toEqual([
      'src/game.ts',
      'src/rules.ts',
      'src/game.test.ts',
    ]);
    expect(task.diff.map((f) => f.path)).toEqual(['src/game.ts']);
    expect(task.report?.verdict).toBe('success');
    expect(task.report?.markdown).toContain('plan de secours');
    expect(task.review?.summary).toMatch(/^revue non faite/);
    expect(task.review?.blocking).toEqual([]);
    const after = Object.fromEntries(mission.steps.map((s) => [s.id, s]));
    expect(after['goal']!.error).toBeUndefined();
    expect(after['design']!.error).toBeUndefined();
    const review = mission.steps.find((s) => s.actor === 'REVIEWER');
    expect(review?.status).not.toBe('failed');
    expect(review?.error).toBeUndefined();
    const sandboxGame = readFileSync(join(task.worktreePath, 'src', 'game.ts'), 'utf8');
    expect(sandboxGame).toBe(GAME);

    const goalCalls = bodies().filter((b) => system(b).includes(GOAL_MARKER));
    expect(goalCalls.map((b) => b.options?.num_predict)).toEqual([
      STEP_LIMITS.goal.maxTokens,
      STEP_LIMITS.goal.maxTokens,
    ]);
    const factoryCalls = bodies().filter((b) => system(b).includes(FACTORY_MARKER));
    expect(factoryCalls.map((b) => b.options?.num_predict)).toEqual([300, 300]);
    const writeCalls = bodies().filter((b) => system(b).includes(WRITE_MARKER));
    expect(writeCalls.map((b) => b.options?.num_predict)).toEqual([
      STEP_LIMITS.edit.maxTokens,
      STEP_LIMITS.edit.maxTokens,
    ]);
    expect(writeCalls[0]?.tools ?? []).toEqual([]);
    expect(h.audit.list).toBeDefined();
    const audited = (await h.audit.list()).filter((e) => e.toolName === 'dev_write_file');
    expect(audited.map((e) => e.decision)).toEqual(['approved']);
    expect(bodies().every((b) => typeof b.options?.num_predict === 'number')).toBe(true);
    await h.instance.discardTask();
  }, 180_000);

  it('jeu ambitieux pour un petit modèle : mission lancée (avertissement), pas de refus par difficulté', async () => {
    const h = createHarness({
      base,
      repo,
      fake,
      developer: { codeModel: MODEL, projectsRoot },
      intercept: offlineNpm,
    });
    await h.instance.validate(repo);
    const before = bodies().length;
    const started = await h.instance.startMission(
      'new-project',
      'Crée un Tetris complet dans le navigateur avec niveaux, score, sauvegarde des meilleurs scores et musique.',
      true,
    );
    expect(started.mission).not.toBeNull();
    expect(bodies().length).toBeGreaterThan(before);
    expect(String(started.notice ?? '')).not.toMatch(/^Mission non lancée/);
    expect(started.missionGate).toBeNull();
    expect(started.mission?.gate).toMatchObject({
      ok: true,
      difficulty: { level: 3, template: 'web-game' },
    });
    await h.instance.discardTask();
  }, 180_000);

  it('un modèle au format qui vise Jarvis : objectif sans le dépôt de Jarvis, gabarit jeu, plan du gabarit', async () => {
    const LOST = 'petit:egare';
    fake.installed.set(LOST, 2e9);
    fake.scripts.set(LOST, (body) => {
      const text = system(body);
      if (text.includes(WRITE_MARKER) && writeRequest(body)?.path === 'src/game.ts')
        return codeBlock(GAME);
      if (text.includes(GOAL_MARKER))
        return {
          content: JSON.stringify({
            goal: 'Un Pong jouable au clavier.',
            questions: [],
            criteria: ['les tests passent'],
            constraints: [],
          }),
        };
      if (text.includes(FACTORY_MARKER))
        return {
          content: JSON.stringify({
            template: 'vite-react',
            name: 'Pong Electron',
            description: 'Pong en React.',
          }),
        };
      if (text.includes(PLAN_MARKER))
        return {
          content: JSON.stringify({
            resume: 'Pong dans le renderer.',
            criteres: ['le jeu s’affiche'],
            fichiers: [
              { chemin: 'apps/desktop/src/renderer/main.tsx', action: 'modifier', pourquoi: 'jeu' },
              {
                chemin: 'apps/desktop/src/__tests__/pong.test.ts',
                action: 'creer',
                pourquoi: 'tests',
              },
            ],
            tests: ['typecheck', 'test'],
          }),
        };
      return { content: RAMBLE };
    });
    const h = createHarness({
      base,
      repo,
      fake,
      developer: { codeModel: LOST, projectsRoot },
      intercept: offlineNpm,
    });
    await h.instance.validate(repo);
    const from = fake.requests.length;
    const done = await h.instance.startMission(
      'new-project',
      'Crée un Pong jouable dans le navigateur : deux raquettes, une balle, le score.',
      true,
    );
    const mission = done.mission!;
    expect(mission.status, mission.summary ?? '').toBe('finished');
    const goalSystem = fake.requests
      .slice(from)
      .filter((r) => r.path === '/api/chat')
      .map((r) => system(r.body as ChatBody))
      .find((s) => s.includes(GOAL_MARKER))!;
    expect(goalSystem).toContain(NEW_PROJECT_CONTEXT.promptContext);
    expect(goalSystem).not.toContain(JARVIS_PROJECT_PROFILE.promptContext);
    const design = mission.steps.find((s) => s.id === 'design')!;
    expect(design.detail).toMatch(/règle fixe : un jeu part du gabarit jeu/);
    expect(existsSync(join(projectsRoot, 'pong-electron', 'src', 'game.test.ts'))).toBe(true);

    const task = done.codeTask!;
    expect(task.planFallback).toMatch(
      /ne touchait aucun fichier d’entrée du gabarit \(src\/game\.ts, src\/rules\.ts, src\/game\.test\.ts\)/,
    );
    expect(task.plan?.files.map((f) => f.path)).toEqual([
      'src/game.ts',
      'src/rules.ts',
      'src/game.test.ts',
    ]);
    expect(task.diff.map((f) => f.path)).toEqual(['src/game.ts']);
    expect(task.report?.verdict).toBe('success');
    await h.instance.discardTask();
  }, 180_000);
});
