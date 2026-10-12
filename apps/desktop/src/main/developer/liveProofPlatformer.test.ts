import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLiveHarness } from './controllerHarness.testkit.js';
import { createFixtureRepo } from './task/taskWorkflow.testkit.js';

const LIVE = process.env.LIVE_PLATFORMER_MISSION === '1';
let base = '';
let projectsRoot = '';
let repo = '';

const REQUEST =
  'Pour thedexios : jeu de plateforme 2D vue de côté sur le gabarit Jarvis — compose un niveau jouable (plateformes, collectable, piège, zone de victoire), formes simples.';

function run(cwd: string, cmd: string, args: string[]) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe.runIf(LIVE)('preuve live mission plateforme (Ollama réel)', () => {
  beforeAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
    base = mkdtempSync(join(tmpdir(), 'jarvis-live-platformer-'));
    projectsRoot = join(base, 'Projets');
    repo = join(base, 'Jarvis');
    mkdirSync(join(base, 'home'), { recursive: true });
    createFixtureRepo(repo);
    mkdirSync(projectsRoot, { recursive: true });
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
              model: 'qwen3.5:4b',
              category: 'role:CODER:mission:new-project',
              success: true,
            },
            {
              at: 3,
              model: 'qwen3.5:4b',
              category: 'role:CODER:mission:new-project',
              success: true,
            },
          ],
        },
        null,
        2,
      ),
    );
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it(
    'modèle en mémoire compose level.ts, tests et build passent',
    async () => {
      const h = createLiveHarness({
        base,
        repo,
        developer: { codeModel: '', projectsRoot },
      });
      await h.instance.validate(repo);
      const started = await h.instance.startMission('new-project', REQUEST, true);
      expect(started.mission?.status, String(started.notice ?? started.mission?.summary ?? '')).toBe('finished');
      const task = started.codeTask!;
      expect(task.report?.verdict).toBe('success');
      expect(task.model).toBe('qwen3.5:4b');

      const dir = task.worktreePath;
      const level = readFileSync(join(dir, 'src', 'level.ts'), 'utf8');
      expect(level.length).toBeGreaterThan(80);
      run(dir, 'npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts']);
      const testOut = run(dir, 'npm', ['test']);
      expect(testOut).toMatch(/passed|Tests/i);
      run(dir, 'npm', ['run', 'build']);
      expect(existsSync(join(dir, 'dist', 'index.html'))).toBe(true);
    },
    1_800_000,
  );
});
