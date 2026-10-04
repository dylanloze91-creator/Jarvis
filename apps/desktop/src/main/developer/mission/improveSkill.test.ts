import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DESIGN_MARKER,
  EDIT_MARKER,
  GOAL_MARKER,
  IMPROVE_MARKER,
  PLAN_MARKER,
  RESEARCH_MARKER,
  REVIEW_MARKER,
  SKILL_MARKER,
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

const base = mkdtempSync(join(tmpdir(), 'jarvis-ameliorer-'));
const repo = join(base, 'Jarvis');
const projectsRoot = join(base, 'Projets');
const CODE = 'scripte:ameliorer';
const fake = new FakeOllama();
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const system = (body: ChatBody) => body.messages.find((m) => m.role === 'system')?.content ?? '';

const loop = taskScript();
function script(body: ChatBody): Reply {
  const text = system(body);
  const done = body.messages.filter((m) => m.role === 'tool').length;
  const write = text.includes(WRITE_MARKER) ? writeRequest(body) : null;
  if (write?.path === 'src/tools/cube_stl.ts')
    return codeBlock("export const cube = () => 'solid cube';");
  if (text.includes(IMPROVE_MARKER)) {
    if (done === 0) return { call: { name: 'dev_read_file', arguments: { path: 'src/index.ts' } } };
    return {
      content: JSON.stringify({
        proposals: [
          {
            title: 'Exporter une constante VERSION',
            kind: 'refactor',
            evidence: [{ path: 'src/index.ts', excerpt: 'export {};' }],
            gain: 'version lisible',
            proofTests: ['npm test'],
          },
          {
            title: 'Supprimer un eval dangereux',
            kind: 'security',
            evidence: [{ path: 'src/index.ts', excerpt: 'eval(code)' }],
          },
          {
            title: 'Découper scripts/check.mjs',
            kind: 'refactor',
            evidence: [{ metric: 'largest:scripts/check.mjs' }],
          },
          { title: 'Tout réécrire en microservices', kind: 'architecture' },
        ],
      }),
    };
  }
  if (text.includes(GOAL_MARKER))
    return {
      content: JSON.stringify({ goal: 'Objectif vérifiable.', questions: [], criteria: ['tests'] }),
    };
  if (text.includes(DESIGN_MARKER))
    return {
      content: JSON.stringify({
        architecture: 'Un fichier src/version.ts.',
        modules: [{ name: 'version', files: ['src/version.ts'] }],
      }),
    };
  if (text.includes(RESEARCH_MARKER))
    return {
      content: JSON.stringify({
        findings: [{ fact: 'Le format STL est un texte simple', source: 'connaissance' }],
        uncertainties: ['aucune bibliothèque vérifiée'],
        recommendation: 'écrire le STL à la main',
      }),
    };
  if (text.includes(SKILL_MARKER))
    return {
      content: JSON.stringify({
        skill: 'Modèles 3D',
        description: 'Génère des modèles 3D simples.',
        tools: [{ name: 'Cube STL', description: 'Écrit un cube au format STL.' }],
      }),
    };
  if (text.includes(REVIEW_MARKER)) return { content: '{"verdict": "ok", "issues": []}' };
  const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
  if (user.includes('Compétence « Modèles 3D »') || text.includes('src/tools/cube_stl.ts')) {
    if (text.includes(PLAN_MARKER))
      return {
        content: JSON.stringify({
          resume: 'Outil cube_stl.',
          fichiers: [{ chemin: 'src/tools/cube_stl.ts', action: 'creer' }],
          tests: ['test'],
        }),
      };
    if (text.includes(EDIT_MARKER)) {
      const step = {
        name: 'dev_create_file',
        arguments: {
          path: 'src/tools/cube_stl.ts',
          content: "export const cube = () => 'solid cube';\n",
        },
      };
      return done === 0 ? { call: step } : { content: 'Fait.' };
    }
  }
  return loop(body);
}

function offlineNpm(spec: { cwd: string }, display: string) {
  if (!existsSync(join(spec.cwd, 'jarvis-skill.json'))) return null;
  if (display.startsWith('npm install')) {
    writeFileSync(join(spec.cwd, 'package-lock.json'), '{"lockfileVersion": 3, "packages": {}}\n');
    return fakeOutcome(display);
  }
  if (display.startsWith('npm ci') || display === 'npm run typecheck') return fakeOutcome(display);
  if (display === 'npm test') return fakeOutcome(display, '      Tests  3 passed (3)\n');
  return null;
}

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(repo);
  await fake.start();
  fake.installed.set(CODE, 3e9);
  fake.scripts.set(CODE, script);
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

describe('« Améliorer » et « Compétence » (0.5.5)', () => {
  it('améliorer : mesures, propositions, preuves relues ; une proposition retenue devient une mission liée', async () => {
    const h = createHarness({ base, repo, fake, developer: { codeModel: CODE } });
    await h.instance.validate(repo);
    const head = git(repo, 'rev-parse', 'HEAD');
    const state = await h.instance.startMission(
      'improve',
      'Analyse Jarvis et propose des améliorations.',
      true,
    );
    const mission = state.mission!;
    expect(mission.status, mission.summary ?? '').toBe('finished');
    expect(mission.verdict).toBe('success');
    expect(mission.steps.map((s) => `${s.id}:${s.actor}:${s.status}`)).toEqual([
      'measure:JARVIS:done',
      'proposals:ARCHITECT:done',
      'verify:JARVIS:done',
    ]);
    expect(mission.steps[0]!.model).toBeUndefined();
    expect(
      mission.proposals?.map((p) => `${p.retained}:${p.evidence.map((e) => e.status)}`),
    ).toEqual(['true:verified', 'false:not-found', 'true:metric', 'false:']);
    expect(state.codeTask).toBeNull();
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(repo, 'status', '--porcelain')).toBe('');

    expect((await h.instance.startProposal(mission.id, 1, 'jarvis')).notice).toMatch(
      /Avis non retenu/,
    );
    const linked = await h.instance.startProposal(mission.id, 0, 'jarvis');
    expect(linked.mission?.kind).toBe('modify');
    expect(linked.mission?.request).toMatch(
      /^Exporter une constante VERSION\. Preuves : src\/index\.ts/,
    );
    expect(linked.mission?.fromProposal).toEqual({ missionId: mission.id, index: 0 });
    expect(linked.mission?.status, linked.mission?.summary ?? '').toBe('finished');
    const reopened = await h.instance.openMission(mission.id, 'jarvis');
    expect(reopened.mission?.proposals?.[0]?.missionId).toBe(linked.mission!.id);
    expect((await h.instance.startProposal(mission.id, 0, 'jarvis')).notice).toMatch(
      /déjà sa mission/,
    );
    await h.instance.discardTask();
  }, 180_000);

  it('compétence : recherche sans web, outils conçus, projet à part hors du chat, puis la boucle', async () => {
    const h = createHarness({
      base,
      repo,
      fake,
      developer: { codeModel: CODE, projectsRoot },
      intercept: offlineNpm,
    });
    await h.instance.validate(repo);
    const done = await h.instance.startMission(
      'skill',
      'Crée une compétence qui génère des modèles 3D simples.',
      true,
    );
    const mission = done.mission!;
    expect(mission.status, mission.summary ?? '').toBe('finished');
    expect(mission.steps.slice(0, 5).map((s) => `${s.id}:${s.actor}:${s.status}`)).toEqual([
      'goal:REASONER:done',
      'research:RESEARCHER:done',
      'design:ARCHITECT:done',
      'create:USER:done',
      'plan-1:CODER:done',
    ]);
    const dir = join(projectsRoot, 'modeles-3d');
    const manifest = JSON.parse(readFileSync(join(dir, 'jarvis-skill.json'), 'utf8'));
    expect(manifest).toMatchObject({ chat: false, tools: ['bonjour'], planned: ['cube_stl'] });
    expect(done.codeTask?.diff.map((f) => f.path)).toEqual(['src/tools/cube_stl.ts']);
    const projects = (await h.instance.listProjects()).projects!;
    expect(projects.find((p) => p.id === 'modeles-3d')).toMatchObject({
      template: 'node-skill',
      origin: 'created',
    });
    await h.instance.discardTask();
  }, 180_000);

  it('registre : une entrée d’une autre version est ignorée à la lecture et gardée à l’écriture', async () => {
    const store = join(base, 'userData', 'developer', 'projects', 'registry.json');
    const registry = JSON.parse(readFileSync(store, 'utf8'));
    const foreign = {
      id: 'futur',
      name: 'Futur',
      path: '/x',
      kind: 'rust',
      origin: 'created',
      createdAt: 1,
    };
    registry.projects.push(foreign);
    writeFileSync(store, JSON.stringify(registry));
    const h = createHarness({ base, repo, fake, developer: { codeModel: CODE, projectsRoot } });
    const listed = await h.instance.listProjects();
    expect(listed.projects?.map((p) => p.id)).toEqual(['jarvis', 'modeles-3d']);
    await h.instance.forgetProject('modeles-3d');
    const after = JSON.parse(readFileSync(store, 'utf8'));
    expect(after.projects).toEqual([foreign]);
  }, 60_000);
});
