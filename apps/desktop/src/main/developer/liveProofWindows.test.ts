import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
    if (process.env.KEEP_WIN_PROOF === '1') {
      base = '/tmp/jarvis-win-exe-proof-persist';
      if (existsSync(base)) rmSync(base, { recursive: true, force: true });
    } else if (base) rmSync(base, { recursive: true, force: true });
    base = process.env.KEEP_WIN_PROOF === '1' ? base : mkdtempSync(join(tmpdir(), 'jarvis-live-win-'));
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
    if (process.env.KEEP_WIN_PROOF !== '1') rmSync(base, { recursive: true, force: true });
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
      if (started.mission?.status !== 'finished') {
        const dump = {
          notice: started.notice,
          summary: started.mission?.summary,
          model: started.codeTask?.model,
          verdict: started.codeTask?.report?.verdict,
          report: started.codeTask?.report,
          runs: started.codeTask?.runs,
          planFallback: started.codeTask?.planFallback,
          repeatedFailure: started.codeTask?.repeatedFailure,
        };
        writeFileSync('/tmp/jarvis-live-win-fail.json', `${JSON.stringify(dump, null, 2)}\n`);
      }
      expect(started.mission?.status, String(started.notice ?? started.mission?.summary ?? '')).toBe('finished');
      const task = started.codeTask!;
      expect(task.report?.verdict).toBe('success');
      expect(task.model).toBe('qwen3.5:4b');

      const project = (await h.instance.listProjects()).projects!.find(
        (p) => p.id === started.mission!.projectId,
      )!;
      const dir = project.path;
      const slnFile = readdirSync(dir).find((f) => f.endsWith('.sln'));
      expect(slnFile, `solution .sln dans ${dir}`).toBeTruthy();

      const sln = slnFile!;
      run(dir, 'dotnet', ['restore', sln]);
      const testOut = run(dir, 'dotnet', ['test', sln, '--no-restore']);
      expect(testOut).toMatch(/réussi|passed|succeeded/i);

      const publishCmd = dotnetPublishWinExeCommand(project.name);
      const exeRel = dotnetWinExeArtifactRelative(project.name);
      const exe = join(dir, exeRel);
      expect(existsSync(exe), `fichier attendu : ${exe}`).toBe(true);
      const exeBytes = readFileSync(exe).length;
      expect(exeBytes).toBeGreaterThan(10_000);
      mkdirSync('/tmp/jarvis-final-proof', { recursive: true });
      copyFileSync(exe, join('/tmp/jarvis-final-proof', basename(exe)));
      writeFileSync(
        '/tmp/jarvis-live-win-success.json',
        `${JSON.stringify(
          {
            model: task.model,
            projectDir: dir,
            exe,
            exeBytes,
            slnFile,
            publishCmd,
            testOutSnippet: testOut.split('\n').slice(-8).join('\n'),
          },
          null,
          2,
        )}\n`,
      );
    },
    1_800_000,
  );

  it(
    '2e appli .exe simple (stats texte) via le même chemin mission',
    async () => {
      const h = createLiveHarness({
        base,
        repo,
        developer: { codeModel: '', projectsRoot },
      });
      await h.instance.validate(repo);
      const started = await h.instance.startMission(
        'new-project',
        'Crée une application Windows .exe : une classe qui compte les mots d’un texte dans Core, avec tests xUnit.',
        true,
      );
      expect(started.mission?.status, String(started.notice ?? started.mission?.summary ?? '')).toBe('finished');
      expect(started.codeTask?.model).toBe('qwen3.5:4b');
      const project = (await h.instance.listProjects()).projects!.find(
        (p) => p.id === started.mission!.projectId,
      )!;
      const dir = project.path;
      const slnFile = readdirSync(dir).find((f) => f.endsWith('.sln'))!;
      const testOut = run(dir, 'dotnet', ['test', slnFile]);
      expect(testOut).toMatch(/réussi|passed|succeeded/i);
      const exe = join(dir, dotnetWinExeArtifactRelative(project.name));
      expect(existsSync(exe), exe).toBe(true);
      expect(readFileSync(exe).length).toBeGreaterThan(10_000);
    },
    1_800_000,
  );
});
