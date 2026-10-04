import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DESIGN_MARKER,
  EDIT_MARKER,
  FACTORY_MARKER,
  GOAL_MARKER,
  PLAN_MARKER,
  REVIEW_MARKER,
  WRITE_MARKER,
} from '@jarvis/core';
import { createHarness, fakeOutcome } from '../controllerHarness.testkit.js';
import { FakeOllama, type ChatBody, type Reply } from '../models/fakeOllama.testkit.js';
import {
  codeBlock,
  createFixtureRepo,
  taskScript,
  writeRequest,
} from '../task/taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-projets-'));
const jarvis = join(base, 'Jarvis');
const photos = join(base, 'photos');
const projectsRoot = join(base, 'Projets');
const CODE = 'scripte:projets';
const fake = new FakeOllama();
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const system = (body: ChatBody) => body.messages.find((m) => m.role === 'system')?.content ?? '';

const loop = taskScript();
function script(body: ChatBody): Reply {
  const text = system(body);
  if (text.includes(GOAL_MARKER))
    return {
      content: JSON.stringify({
        goal: 'Une constante VERSION exportée.',
        questions: [],
        criteria: ['aucun nouvel échec'],
      }),
    };
  if (text.includes(FACTORY_MARKER))
    return {
      content: JSON.stringify({
        template: 'cli',
        name: 'Photos par date',
        description: 'Renomme les photos par date.',
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
  return loop(body);
}

/** Modèle de code du projet neuf : lit src/main.ts, planifie, le modifie. */
function factoryScript(body: ChatBody): Reply {
  const text = system(body);
  const write = text.includes(WRITE_MARKER) ? writeRequest(body) : null;
  if (write?.path === 'src/main.ts' && write.current)
    return codeBlock(write.current.replace("name: 'monde'", "name: 'le monde'"));
  const done = body.messages.filter((m) => m.role === 'tool').length;
  if (text.includes(PLAN_MARKER)) {
    if (done === 0) return { call: { name: 'dev_read_file', arguments: { path: 'src/main.ts' } } };
    return {
      content: JSON.stringify({
        resume: 'Saluer « le monde ».',
        fichiers: [{ chemin: 'src/main.ts', action: 'modifier', pourquoi: 'texte' }],
        tests: ['test', 'test-core'],
      }),
    };
  }
  if (text.includes(EDIT_MARKER)) {
    const steps = [
      { name: 'dev_read_file', arguments: { path: 'src/main.ts' } },
      {
        name: 'dev_edit_file',
        arguments: { path: 'src/main.ts', search: "name: 'monde'", replace: "name: 'le monde'" },
      },
    ];
    return steps[done] ? { call: steps[done]! } : { content: 'Fait.' };
  }
  return script(body);
}

/** npm hors ligne : install crée package-lock.json, les tests du gabarit répondent comme Vitest. */
function offlineNpm(spec: { cwd: string }, display: string) {
  if (display.startsWith('npm install')) {
    writeFileSync(join(spec.cwd, 'package-lock.json'), '{"lockfileVersion": 3, "packages": {}}\n');
    return fakeOutcome(display, 'added 0 packages');
  }
  if (!existsSync(join(spec.cwd, 'src', 'main.ts'))) return null;
  if (display.startsWith('npm ci')) return fakeOutcome(display, 'added 0 packages');
  if (display === 'npm run typecheck') return fakeOutcome(display);
  if (display === 'npm test')
    return fakeOutcome(display, ' Test Files  1 passed (1)\n      Tests  2 passed (2)\n');
  return null;
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

describe('projets (0.5.3)', () => {
  it('importer : refus sans package-lock.json, puis liste, mémoire et retrait', async () => {
    const h = createHarness({ base, repo: jarvis, fake, developer: { codeModel: CODE } });
    await h.instance.validate(jarvis);
    const bare = join(base, 'sans-verrou');
    mkdirSync(bare);
    writeFileSync(join(bare, 'package.json'), '{"name": "x", "scripts": {"test": "x"}}\n');
    git(bare, 'init', '-q', '-b', 'main');
    git(bare, 'add', '-A');
    git(
      bare,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'x',
    );
    expect((await h.instance.importProject(bare)).notice).toMatch(/package-lock\.json/);
    expect((await h.instance.importProject(jarvis)).notice).toMatch(/copie de Jarvis/);
    expect((await h.instance.importProject('relatif/x')).notice).toMatch(/chemin complet/);

    const imported = await h.instance.importProject(photos);
    expect(imported.notice).toMatch(/« photos » importé/);
    expect(imported.projects?.map((p) => `${p.id}:${p.kind}:${p.origin}:${p.ok}`)).toEqual([
      'jarvis:jarvis:jarvis:true',
      'photos:node:imported:true',
    ]);
    expect(imported.projects?.[0]?.memoryDefault).toBe(true);
    expect(imported.projects?.[0]?.memory).toContain('CLAUDE.md');
    expect((await h.instance.importProject(photos)).notice).toMatch(/déjà le projet/);

    const saved = await h.instance.saveProjectMemory('photos', 'Note mémoire : jamais de réseau.');
    expect(saved.projects?.find((p) => p.id === 'photos')).toMatchObject({
      memory: 'Note mémoire : jamais de réseau.',
      memoryDefault: false,
    });
    expect(
      JSON.parse(
        readFileSync(
          join(base, 'userData', 'developer', 'projects', 'photos', 'memory.json'),
          'utf8',
        ),
      ).notes,
    ).toBe('Note mémoire : jamais de réseau.');
    expect(existsSync(join(photos, 'memory.json'))).toBe(false);
  }, 60_000);

  it('mission sur un projet importé : sa copie isolée, ses tests, sa mémoire ; Jarvis intact', async () => {
    const h = createHarness({ base, repo: jarvis, fake, developer: { codeModel: CODE } });
    await h.instance.validate(jarvis);
    const jarvisHead = git(jarvis, 'rev-parse', 'HEAD');
    const head = git(photos, 'rev-parse', 'HEAD');
    const before = fake.requests.length;
    const done = await h.instance.startMission(
      'modify',
      'Ajoute une constante VERSION et exporte-la.',
      true,
      'photos',
    );
    const mission = done.mission!;
    expect(mission.status, mission.summary ?? '').toBe('finished');
    expect(mission.projectId).toBe('photos');
    const task = done.codeTask!;
    expect(task.projectId).toBe('photos');
    expect(task.worktreePath.startsWith(join(base, 'photos-taches'))).toBe(true);
    expect(task.plan?.tests).toEqual(['typecheck', 'test']);
    expect(task.plan?.files.find((f) => f.path === 'package.json')?.core).toBe(
      'dépendances et scripts npm',
    );

    const goal = fake.requests
      .slice(before)
      .map((r) => r.body as ChatBody | null)
      .find((b) => b?.messages && system(b).includes(GOAL_MARKER));
    expect(goal?.messages.find((m) => m.role === 'user')?.content).toContain(
      'Note mémoire : jamais de réseau.',
    );
    expect(system(goal!)).toContain('Dépôt : photos, projet Node.js');

    const applied = await h.instance.applyTask();
    expect(applied.task?.outcome, applied.task?.message).toBe('success');
    expect(git(photos, 'rev-parse', 'HEAD^1')).toBe(head);
    expect(existsSync(join(photos, 'src', 'version.ts'))).toBe(true);
    expect(git(jarvis, 'rev-parse', 'HEAD')).toBe(jarvisHead);
    expect(existsSync(join(jarvis, 'src', 'version.ts'))).toBe(false);

    const mine = (await h.audit.list()).filter((e) => e.missionId === mission.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.projectId === 'photos')).toBe(true);
    expect((await h.instance.listMissions('photos')).missions?.[0]?.id).toBe(mission.id);
    expect((await h.instance.listMissions('jarvis')).missions ?? []).toEqual([]);
    await h.instance.discardTask();
  }, 180_000);

  it('nouveau projet : gabarit, carte, npm install, git init, puis la boucle sur le projet neuf', async () => {
    fake.scripts.set(CODE, factoryScript);
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE, projectsRoot },
      intercept: offlineNpm,
    });
    await h.instance.validate(jarvis);
    const done = await h.instance.startMission(
      'new-project',
      'Crée une petite CLI qui salue le monde.',
      true,
    );
    const mission = done.mission!;
    expect(mission.status, mission.summary ?? '').toBe('finished');
    expect(mission.projectId).toBe('photos-par-date');
    const dir = join(projectsRoot, 'photos-par-date');
    expect(mission.steps.slice(0, 4).map((s) => `${s.id}:${s.actor}:${s.status}`)).toEqual([
      'goal:REASONER:done',
      'design:ARCHITECT:done',
      'create:USER:done',
      'plan-1:CODER:done',
    ]);
    const card = h.cards.find((c) => c.toolName === 'dev_create_project')!;
    expect(card.safety.level).toBe('always-confirm');
    expect(card.command).toContain('npm install --ignore-scripts --no-audit --no-fund');
    expect(card.command).toContain('git init -b main');

    expect(git(dir, 'log', '--format=%an|%s')).toBe(
      'Jarvis Développeur|Projet créé par Jarvis Développeur',
    );
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(dir, 'remote')).toBe('');
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name).toBe(
      'photos-par-date',
    );

    const task = done.codeTask!;
    expect(task.projectId).toBe('photos-par-date');
    expect(task.plan?.tests).toEqual(['typecheck', 'test']);
    expect(task.report?.verdict).toBe('success');
    expect(task.diff.map((f) => f.path)).toEqual(['src/main.ts']);

    const projects = (await h.instance.listProjects()).projects!;
    expect(projects.find((p) => p.id === 'photos-par-date')).toMatchObject({
      origin: 'created',
      template: 'node-cli',
      ok: true,
    });
    const store = join(base, 'userData', 'developer', 'projects');
    expect(existsSync(join(store, 'photos-par-date', 'missions', `${mission.id}.json`))).toBe(true);
    expect(existsSync(join(store, 'nouveau', 'missions', `${mission.id}.json`))).toBe(false);

    const applied = await h.instance.applyTask();
    expect(applied.task?.outcome, applied.task?.message).toBe('success');
    expect(readFileSync(join(dir, 'src', 'main.ts'), 'utf8')).toContain("name: 'le monde'");
    await h.instance.discardTask();
  }, 180_000);

  it('nouveau projet refusé : rien n’est écrit, la mission reste dans « nouveau »', async () => {
    fake.scripts.set(CODE, factoryScript);
    const root = join(base, 'Projets-refus');
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE, projectsRoot: root },
      intercept: offlineNpm,
      answer: (card) => card.toolName !== 'dev_create_project',
    });
    await h.instance.validate(jarvis);
    const done = await h.instance.startMission('new-project', 'Crée une petite CLI.', true);
    expect(done.mission).toMatchObject({
      status: 'cancelled',
      projectId: 'nouveau',
      summary: 'Création refusée : rien n’a été écrit.',
    });
    expect(existsSync(root)).toBe(false);
    expect(done.codeTask).toBeNull();
    expect((await h.instance.listMissions('nouveau')).missions?.[0]?.id).toBe(done.mission!.id);
  }, 60_000);
});
