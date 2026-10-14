import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FACTORY_MARKER,
  GOAL_MARKER,
  newProjectMissionFromProjectChat,
  EDIT_MARKER,
  PLAN_MARKER,
  REVIEW_MARKER,
  WRITE_MARKER,
} from '@jarvis/core';
import { createHarness, fakeOutcome } from '../controllerHarness.testkit.js';
import { FakeOllama, type ChatBody, type Reply } from '../models/fakeOllama.testkit.js';
import type { RunOutcome, RunSpec } from '../runner.js';
import { codeBlock, createFixtureRepo, replyForPlannedFileWrite, writeRequest } from '../task/taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-platformer-'));
const jarvis = join(base, 'Jarvis');
const projectsRoot = join(base, 'Projets');
const CODE = 'scripte:plateforme';
const REQUEST =
  'Pour thedexios : un jeu de plateforme 2D vue de côté sur le gabarit (saut, sol, un collectable, un piège, victoire). Compose un niveau jouable avec des plateformes à franchir, formes simples uniquement.';

const EXTENDED_LEVEL = `import type { LevelData } from './types.js';

/** Parcours pour thedexios : plateformes en escalier, formes simples. */
export const PLAY_LEVEL: LevelData = {
  platforms: [
    { x: 0, y: 440, w: 800, h: 40 },
    { x: 180, y: 340, w: 140, h: 16 },
    { x: 420, y: 280, w: 120, h: 16 },
    { x: 580, y: 200, w: 160, h: 16 },
    { x: 300, y: 150, w: 110, h: 14 },
  ],
  collectible: { x: 230, y: 308, w: 20, h: 20 },
  hazard: { x: 360, y: 416, w: 56, h: 24 },
  goal: { x: 720, y: 360, w: 36, h: 80 },
  spawn: { x: 48, y: 380 },
};
`;

function runReal(spec: RunSpec, display: string): RunOutcome {
  const parts = display.split(/\s+/);
  const cmd = parts[0]!;
  const args = parts.slice(1);
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: spec.cwd,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    });
    return fakeOutcome(display, stdout, 0);
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      ...fakeOutcome(display, err.stdout ?? '', err.status ?? 1),
      stderr: err.stderr ?? '',
      error: String(error),
    };
  }
}

function hybridNpm(spec: RunSpec, display: string): RunOutcome | null {
  if (!existsSync(join(spec.cwd, 'package.json'))) return null;
  if (display.startsWith('npm install') || display.startsWith('npm ci')) {
    const install = display.startsWith('npm ci')
      ? 'npm install --no-audit --no-fund --ignore-scripts'
      : display;
    return runReal(spec, install);
  }
  if (display === 'npm test' || display === 'npm run typecheck' || display === 'npm run build') {
    return runReal(spec, display);
  }
  return null;
}

const RULES_TS = `export const RULES = {
  title: 'Plateforme Dexios',
  gravity: 1400,
  moveSpeed: 220,
  jumpSpeed: 480,
  maxFall: 700,
  playerW: 22,
  playerH: 28,
  requireCollectibleForWin: false,
};
`;

function missionScript(): (body: ChatBody) => Reply {
  return (body: ChatBody) => {
    const text =
      body.messages.find((m) => m.role === 'system')?.content ??
      body.messages.map((m) => m.content).join('\n');
    const planned = replyForPlannedFileWrite(body, {
      'src/level.ts': EXTENDED_LEVEL,
      'src/rules.ts': RULES_TS,
    });
    if (planned) return planned;
    const write = writeRequest(body);
    if (text.includes(PLAN_MARKER))
      return {
        content: JSON.stringify({
          resume: 'Étendre le niveau dans level.ts.',
          fichiers: [
            { chemin: 'src/level.ts', action: 'modifier' },
            { chemin: 'src/rules.ts', action: 'modifier' },
          ],
          tests: ['typecheck', 'test'],
        }),
      };
    if (text.includes(FACTORY_MARKER))
      return {
        content: JSON.stringify({
          template: 'web-game',
          name: 'Plateforme Dexios',
          description: 'Jeu de plateforme 2D original',
        }),
      };
    if (text.includes(GOAL_MARKER))
      return {
        content: JSON.stringify({
          goal: REQUEST,
          questions: [],
          criteria: ['niveau jouable', 'tests verts'],
        }),
      };
    if (text.includes(REVIEW_MARKER)) return { content: '{"verdict": "ok", "issues": []}' };
    if (text.includes(EDIT_MARKER)) {
      const done = body.messages.filter((m) => m.role === 'tool').length;
      const steps = [
        { name: 'dev_read_file', arguments: { path: 'src/level.ts' } },
        { name: 'dev_write_file', arguments: { path: 'src/level.ts', content: EXTENDED_LEVEL } },
        {
          name: 'dev_write_file',
          arguments: {
            path: 'src/rules.ts',
            content: `export const RULES = {
  title: 'Plateforme Dexios',
  gravity: 1400,
  moveSpeed: 220,
  jumpSpeed: 480,
  maxFall: 700,
  playerW: 22,
  playerH: 28,
  requireCollectibleForWin: false,
};
`,
          },
        },
      ];
      return steps[done] ? { call: steps[done]! } : { content: 'Fait.' };
    }
    if (text.includes(WRITE_MARKER) && write?.path === 'src/level.ts') return codeBlock(EXTENDED_LEVEL);
    if (text.includes(WRITE_MARKER) && write?.path === 'src/rules.ts')
      return codeBlock(`export const RULES = {
  title: 'Plateforme Dexios',
  gravity: 1400,
  moveSpeed: 220,
  jumpSpeed: 480,
  maxFall: 700,
  playerW: 22,
  playerH: 28,
  requireCollectibleForWin: false,
};
`);
    return { content: 'Je compose le parcours.' };
  };
}

const fake = new FakeOllama();

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  mkdirSync(join(base, 'userData', 'developer'), { recursive: true });
  writeFileSync(
    join(base, 'userData', 'developer', 'code-model.json'),
    JSON.stringify(
      {
        calibration: null,
        validation: null,
        expertsConfirmedAt: null,
        benches: [],
        realBenches: [],
        modelRuns: [
          {
            at: 1,
            model: 'qwen2.5:3b',
            category: 'role:CODER:mission:new-project',
            success: false,
          },
          {
            at: 2,
            model: CODE,
            category: 'role:CODER:mission:new-project',
            success: true,
          },
        ],
      },
      null,
      2,
    ),
  );
  createFixtureRepo(jarvis);
  await fake.start();
  fake.installed.set(CODE, 4e9);
  fake.scripts.set(CODE, missionScript());
});

afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

describe('chemin mission plateforme 2D (thedexios)', () => {
  it('discussion développeur : la demande plateforme part en mission nouveau projet', () => {
    expect(newProjectMissionFromProjectChat(REQUEST)).toBe(true);
  });

  it(
    'mission → niveau étendu, npm test et build réels',
    async () => {
      const h = createHarness({
        base,
        repo: jarvis,
        fake,
        developer: { codeModel: CODE, projectsRoot },
        intercept: hybridNpm,
      });
      await h.instance.validate(jarvis);
      const done = await h.instance.startMission('new-project', REQUEST, true);
      expect(done.mission?.status, String(done.mission?.summary ?? done.notice ?? '')).toBe(
        'finished',
      );
      expect(done.codeTask?.report?.verdict).toBe('success');
      expect(done.codeTask?.model).toBe(CODE);
      if (done.codeTask?.applied) expect(done.codeTask.applied.revertedAt).toBeNull();

      const view = (await h.instance.listProjects()).projects!.find(
        (p) => p.id === done.mission!.projectId,
      )!;
      const projectDir = view.path;
      const levelWt = readFileSync(join(done.codeTask!.worktreePath, 'src', 'level.ts'), 'utf8');
      expect(levelWt).toMatch(/580,\s*y:\s*200/);
      const levelOnDisk = readFileSync(join(projectDir, 'src', 'level.ts'), 'utf8');
      expect(levelOnDisk).toMatch(/580,\s*y:\s*200/);
      execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], {
        cwd: done.codeTask!.worktreePath,
      });
      const testOut = execFileSync('npm', ['test'], {
        cwd: done.codeTask!.worktreePath,
        encoding: 'utf8',
      });
      expect(testOut).toMatch(/passed/i);
      execFileSync('npm', ['run', 'build'], { cwd: done.codeTask!.worktreePath });
    },
    300_000,
  );

  it(
    'aperçu Electron noir : correction puis échec exact, jamais faux succès sur gabarit neutre',
    async () => {
      const h = createHarness({
        base,
        repo: jarvis,
        fake,
        developer: { codeModel: CODE, projectsRoot },
        intercept: hybridNpm,
        verifyWebGameRuntime: async () => ({
          ok: false,
          detail: 'Canvas entier uniforme après 8 secondes (écran noir probable).',
        }),
      });
      await h.instance.validate(jarvis);
      const done = await h.instance.startMission('new-project', REQUEST, true);
      expect(done.mission?.status).toBe('failed');
      expect(done.mission?.summary).toMatch(/Canvas entier uniforme/);
      expect(done.codeTask?.report?.verdict).not.toBe('success');
      expect(done.codeTask?.diff.length).toBeGreaterThan(0);
      await h.instance.discardTask();
    },
    300_000,
  );
});
