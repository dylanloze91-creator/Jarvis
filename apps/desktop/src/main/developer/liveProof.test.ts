import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLiveHarness } from './controllerHarness.testkit.js';
import { createFixtureRepo } from './task/taskWorkflow.testkit.js';

const LIVE = process.env.LIVE_DEVELOPER_PROOF === '1';
let base = '';
let projectsRoot = '';
let repo = '';

function run(cwd: string, cmd: string, args: string[]) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe.runIf(LIVE)('preuve live Développeur (Ollama réel)', () => {
  beforeAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
    base = mkdtempSync(join(tmpdir(), 'jarvis-live-proof-'));
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
    'mission nouveau projet → appliquer → build, tests, lancement',
    async () => {
      const h = createLiveHarness({
        base,
        repo,
        developer: { codeModel: '', projectsRoot },
      });
      await h.instance.validate(repo);
      const started = await h.instance.startMission(
        'new-project',
        'Crée un mini jeu dans le navigateur : une balle rebondit dans un canvas 400×300, affiche le score quand elle sort.',
        true,
      );
      expect(started.mission?.status, String(started.notice ?? started.mission?.summary ?? '')).toBe('finished');
      const task = started.codeTask!;
      expect(task.report?.verdict).toBe('success');
      expect(task.model).toBe('qwen3.5:4b');

      const applied = await h.instance.applyTask();
      expect(applied.codeTask?.applied?.merge, applied.notice ?? '').toBeTruthy();

      const slug = started.mission!.projectId;
      const dir = join(projectsRoot, slug);
      expect(existsSync(join(dir, 'package.json'))).toBe(true);

      run(dir, 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
      const testOut = run(dir, 'npm', ['test']);
      expect(testOut).toMatch(/passed|Tests/i);
      run(dir, 'npm', ['run', 'typecheck']);
      run(dir, 'npm', ['run', 'build']);

      const main = join(dir, 'dist', 'index.html');
      expect(existsSync(main) || existsSync(join(dir, 'index.html'))).toBe(true);
      const game = readFileSync(join(dir, 'src', 'game.ts'), 'utf8');
      expect(game.length).toBeGreaterThan(40);
    },
    1_800_000,
  );
});
