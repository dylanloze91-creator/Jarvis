import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotnetPublishWinExeCommand, dotnetWinExeArtifactRelative } from '@jarvis/core';
import { createLiveHarness } from './controllerHarness.testkit.js';
import { createFixtureRepo } from './task/taskWorkflow.testkit.js';

const LIVE = process.env.LIVE_WINDOWS_EXE_PROOF === '1';
let base = '';
let projectsRoot = '';
let repo = '';

function run(cwd: string, cmd: string, args: string[]) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe.runIf(LIVE)('preuve live appli Windows .exe (Ollama réel)', () => {
  beforeAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
    base = mkdtempSync(join(tmpdir(), 'jarvis-live-win-'));
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
    'mission WinForms → tests → publish win-x64 → fichier .exe présent',
    async () => {
      const h = createLiveHarness({
        base,
        repo,
        developer: { codeModel: '', projectsRoot },
      });
      await h.instance.validate(repo);
      const started = await h.instance.startMission(
        'new-project',
        'Crée une petite application Windows de bureau livrée en .exe : un compteur de clics testé dans Core, affiché dans la fenêtre WinForms.',
        true,
      );
      expect(started.mission?.status, started.notice ?? started.mission?.summary).toBe('finished');
      const task = started.codeTask!;
      expect(task.report?.verdict).toBe('success');
      expect(task.model).toBe('qwen3.5:4b');

      const applied = await h.instance.applyTask();
      expect(applied.codeTask?.applied?.merge, applied.notice ?? '').toBeTruthy();

      const project = (await h.instance.listProjects()).projects!.find(
        (p) => p.id === started.mission!.projectId,
      )!;
      const dir = project.path;
      const slnFile = readdirSync(dir).find((f) => f.endsWith('.sln'));
      expect(slnFile, `solution .sln dans ${dir}`).toBeTruthy();

      run(dir, 'dotnet', ['restore', slnFile]);
      const testOut = run(dir, 'dotnet', ['test', slnFile, '--no-restore']);
      expect(testOut).toMatch(/réussi|passed|succeeded/i);

      const publishCmd = dotnetPublishWinExeCommand(project.name);
      const publishArgs = publishCmd.replace(/^dotnet\s+/, '').split(/\s+/);
      run(dir, 'dotnet', publishArgs);

      const exeRel = dotnetWinExeArtifactRelative(project.name);
      const exe = join(dir, exeRel);
      expect(existsSync(exe), `fichier attendu : ${exe}`).toBe(true);
      expect(readFileSync(exe).length).toBeGreaterThan(10_000);
    },
    1_800_000,
  );
});
