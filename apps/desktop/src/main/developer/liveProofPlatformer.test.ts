import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLiveHarness } from './controllerHarness.testkit.js';
import { createFixtureRepo } from './task/taskWorkflow.testkit.js';

const LIVE = process.env.LIVE_PLATFORMER_MISSION === '1';
const MODEL = process.env.LIVE_PLATFORMER_MODEL ?? 'qwen2.5-coder:1.5b';
const PROOF_DIR = '/tmp/jarvis-5.0.31-real-platformer';
let base = '';
let projectsRoot = '';
let repo = '';

const REQUEST =
  'Pour thedexios : jeu de plateforme 2D vue de côté sur le gabarit Jarvis — étends vraiment level.ts avec au moins six plateformes à franchir, un collectable, un piège et une zone de victoire ; formes simples.';

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
        developer: { codeModel: MODEL, projectsRoot },
      });
      await h.instance.validate(repo);
      const started = await h.instance.startMission('new-project', REQUEST, true);
      writeFileSync(
        '/tmp/jarvis-5.0.31-real-platformer-state.json',
        JSON.stringify(started, null, 2),
      );
      expect(
        started.mission?.status,
        String(started.mission?.summary ?? started.notice ?? ''),
      ).toBe('finished');
      const task = started.codeTask!;
      expect(task.report?.verdict).toBe('success');
      expect(task.model).toBe(MODEL);
      expect(task.plan).not.toBeNull();

      const project = (await h.instance.listProjects()).projects!.find(
        (item) => item.id === started.mission!.projectId,
      )!;
      const dir = project.path;
      const level = readFileSync(join(dir, 'src', 'level.ts'), 'utf8');
      expect(level.length).toBeGreaterThan(80);
      expect(level).toMatch(/platform|collect|hazard|goal|spawn/i);
      expect((level.match(/"x"|\bx\s*:/g) ?? []).length).toBeGreaterThanOrEqual(10);
      run(dir, 'npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts']);
      const testOut = run(dir, 'npm', ['test']);
      expect(testOut).toMatch(/passed|Tests/i);
      run(dir, 'npm', ['run', 'build']);
      expect(existsSync(join(dir, 'dist', 'index.html'))).toBe(true);
      const desktop = join(base, 'home', 'Desktop');
      const shortcut = readdirSync(desktop).find((name) => name.endsWith('.bat'));
      expect(shortcut).toBeTruthy();
      expect(readFileSync(join(desktop, shortcut!), 'utf8')).toContain(
        `--jarvis-play-project=${started.mission!.projectId}`,
      );
      rmSync(PROOF_DIR, { recursive: true, force: true });
      cpSync(dir, PROOF_DIR, { recursive: true });
      writeFileSync(
        join(PROOF_DIR, 'REAL-OLLAMA-PROOF.json'),
        JSON.stringify(
          {
            model: MODEL,
            selectedDespiteInstalledPreferredModel: 'qwen3.6:35b-a3b-coding',
            planHandling:
              task.planFallback ??
              'Appels d’outils structurés du modèle réel acceptés ; aucun secours nécessaire.',
            projectId: started.mission!.projectId,
            tests: 'passed',
            build: 'dist/index.html',
          },
          null,
          2,
        ),
      );
    },
    1_800_000,
  );
});
