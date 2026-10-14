import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLiveHarness } from './controllerHarness.testkit.js';
import { createFixtureRepo } from './task/taskWorkflow.testkit.js';

const LIVE = process.env.LIVE_CHAT_BUILD === '1';
const MODEL = process.env.LIVE_PLATFORMER_MODEL ?? 'qwen2.5-coder:3b';
const PROOF_DIR = '/tmp/jarvis-5.0.32-chat-order';
let base = '';
let projectsRoot = '';
let repo = '';

const ORDER =
  'Génère un jeu de plateforme 2D vue de côté, jouable dans le navigateur, avec saut, des plateformes, un objet à ramasser et une arrivée.';

function run(cwd: string, cmd: string, args: string[]) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe.runIf(LIVE)('preuve live : ordre du chat dans le dossier ouvert', () => {
  beforeAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
    base = mkdtempSync(join(tmpdir(), 'jarvis-live-chat-build-'));
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
    'un ordre comme la capture écrit dans nouveau-projet et affiche les agents',
    async () => {
      const h = createLiveHarness({
        base,
        repo,
        developer: {
          codeModel: MODEL,
          chatModel: 'qwen3.5:4b',
          projectsRoot,
        },
      });
      await h.instance.validate(repo);
      const dir = join(projectsRoot, 'nouveau-projet');
      mkdirSync(dir, { recursive: true });
      const prep = await h.instance.prepareWorkspace(dir);
      const id = prep.focusProjectId ?? '';
      expect(id, String(prep.notice ?? '')).toBeTruthy();
      const done = await h.instance.sendProjectChat(id, ORDER);
      writeFileSync(
        '/tmp/jarvis-5.0.32-chat-order-state.json',
        JSON.stringify(
          {
            notice: done.notice,
            mission: done.mission,
            projectChat: done.projectChat,
            codeTaskModel: done.codeTask?.model,
            summary: done.mission?.summary,
          },
          null,
          2,
        ),
      );
      expect(done.mission?.status, String(done.mission?.summary ?? done.notice ?? '')).toBe(
        'finished',
      );
      expect(done.mission?.projectId).toBe(id);
      const agents = done.mission?.agents ?? [];
      expect(agents.length).toBeGreaterThan(0);
      expect(done.codeTask?.model).toBe(MODEL);
      expect(done.codeTask?.model).not.toBe('qwen3.8:latest');
      expect(done.codeTask?.model).not.toBe('qwen3.5:4b');
      const assistant = [...(done.projectChat?.messages ?? [])]
        .reverse()
        .find((message) => message.role === 'assistant');
      expect(assistant?.content).toMatch(/Superviseur/);
      expect(assistant?.content).toMatch(/Agents/);
      expect(assistant?.content?.toLowerCase()).not.toContain('mario');
      const activity = (done.projectChat?.activity ?? []).join('\n');
      expect(activity).not.toMatch(/rien n’est modifié/);
      const view = (await h.instance.listProjects()).projects!.find((item) => item.id === id)!;
      expect(view.path).toBe(dir);
      const level = readFileSync(join(dir, 'src', 'level.ts'), 'utf8');
      expect(level.length).toBeGreaterThan(80);
      expect(level.toLowerCase()).not.toContain('mario');
      expect(level).toMatch(/platform|collect|hazard|goal|spawn/i);
      run(dir, 'npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts']);
      const testOut = run(dir, 'npm', ['test']);
      expect(testOut).toMatch(/passed|Tests/i);
      run(dir, 'npm', ['run', 'build']);
      expect(existsSync(join(dir, 'dist', 'index.html'))).toBe(true);
      rmSync(PROOF_DIR, { recursive: true, force: true });
      cpSync(dir, PROOF_DIR, { recursive: true });
      writeFileSync(
        join(PROOF_DIR, 'REAL-OLLAMA-PROOF.json'),
        JSON.stringify(
          {
            model: done.codeTask?.model,
            chatModelIgnored: 'qwen3.5:4b',
            refusedUninstalledCoder: 'qwen3.8:latest',
            projectId: id,
            folder: dir,
            agents: agents.map((agent) => ({
              name: agent.name,
              status: agent.status,
              role: agent.role,
            })),
            assistant: assistant?.content,
            activity: done.projectChat?.activity ?? [],
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
