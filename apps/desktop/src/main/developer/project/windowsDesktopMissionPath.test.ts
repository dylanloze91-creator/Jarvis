import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dotnetWinExeArtifactRelative,
  FACTORY_MARKER,
  GOAL_MARKER,
  PLAN_MARKER,
  REVIEW_MARKER,
  WRITE_MARKER,
} from '@jarvis/core';
import { createHarness, fakeOutcome } from '../controllerHarness.testkit.js';
import { FakeOllama, type ChatBody, type Reply } from '../models/fakeOllama.testkit.js';
import type { RunOutcome, RunSpec } from '../runner.js';
import { codeBlock, createFixtureRepo, writeRequest } from '../task/taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-win-path-'));
const jarvis = join(base, 'Jarvis');
const projectsRoot = join(base, 'Projets');
const CODE = 'scripte:win-path';

const SALUTATION_CS = (ns: string) =>
  `namespace ${ns}.Core;\npublic static class Salutation\n{\n    public static string Bonjour(string? prenom)\n    {\n        var p = prenom?.Trim();\n        return string.IsNullOrEmpty(p) ? "Bonjour !" : $"Bonjour, {p} !";\n    }\n}\n`;

interface ScriptFiles {
  factoryName: string;
  plan: Array<{ path: string; action: 'creer' | 'modifier' }>;
  writes: Record<string, string>;
}

function offlineDotnet(sdk: boolean) {
  return (spec: RunSpec, display: string): RunOutcome | null => {
    if (!display.startsWith('dotnet ')) return null;
    if (display === 'dotnet --list-sdks')
      return sdk
        ? fakeOutcome(display, '10.0.112 [/usr/lib/dotnet/sdk]\n')
        : { ...fakeOutcome(display, '', 0), code: null, error: 'spawn dotnet ENOENT' };
    if (display.startsWith('dotnet restore')) return fakeOutcome(display, 'Restored.');
    if (display.startsWith('dotnet build') || display.startsWith('dotnet test'))
      return fakeOutcome(display, 'Build succeeded.\nPassed!  - Failed: 0, Passed: 3\n');
    if (display.startsWith('dotnet publish')) return null;
    return null;
  };
}

function missionScript(files: ScriptFiles): (body: ChatBody) => Reply {
  return (body: ChatBody) => {
    const text = body.messages.find((m) => m.role === 'system')?.content ?? '';
    const write = writeRequest(body);
    const writing = text.includes(WRITE_MARKER);
    if (text.includes(PLAN_MARKER))
      return {
        content: JSON.stringify({
          resume: 'Logique Core et tests.',
          fichiers: files.plan.map((f) => ({ chemin: f.path, action: f.action })),
          tests: ['test'],
        }),
      };
    if (text.includes(FACTORY_MARKER))
      return {
        content: JSON.stringify({
          template: 'winforms',
          name: files.factoryName,
          description: files.factoryName,
        }),
      };
    if (text.includes(GOAL_MARKER))
      return {
        content: JSON.stringify({
          goal: files.factoryName,
          questions: [],
          criteria: ['tests verts', '.exe publié'],
        }),
      };
    if (text.includes(REVIEW_MARKER)) return { content: '{"verdict": "ok", "issues": []}' };
    if (writing && write?.path && files.writes[write.path]) return codeBlock(files.writes[write.path]);
    return { content: 'Je ne sais pas.' };
  };
}

const fake = new FakeOllama();

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(jarvis);
  await fake.start();
  fake.installed.set(CODE, 3e9);
  fake.scripts.set('qwen2.5:3b', () => ({ content: 'x' }));
});

afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

function assertExeAndTests(projectTitle: string, projectId: string) {
  const dir = join(projectsRoot, projectId);
  const slnName = readdirSync(dir).find((f) => f.endsWith('.sln'));
  expect(slnName, `solution dans ${dir}`).toBeTruthy();
  execFileSync('dotnet', ['restore', slnName!], { cwd: dir, encoding: 'utf8' });
  const exeRel = dotnetWinExeArtifactRelative(projectTitle);
  const exe = join(dir, exeRel);
  expect(existsSync(exe), exeRel).toBe(true);
  expect(readFileSync(exe).length).toBeGreaterThan(10_000);
  const testOut = execFileSync('dotnet', ['test', slnName!, '--no-restore'], {
    cwd: dir,
    encoding: 'utf8',
  });
  expect(testOut).toMatch(/Passed!|réussi/i);
}

describe('chemin mission bureau .exe (apply + Construire)', () => {
  it('livraison mission : pas de carte apply ni Construire (automatique)', async () => {
    const title = 'Sans Carte';
    const core = 'SansCarte';
    fake.scripts.set(CODE, missionScript({
      factoryName: title,
      plan: [{ path: `src/${core}.Core/Salutation.cs`, action: 'modifier' }],
      writes: { [`src/${core}.Core/Salutation.cs`]: SALUTATION_CS(core) },
    }));
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE, projectsRoot },
      intercept: offlineDotnet(true),
    });
    await h.instance.validate(jarvis);
    const done = await h.instance.startMission(
      'new-project',
      'Fais-moi une appli Windows : garde Salutation dans Core.',
      true,
    );
    expect(done.mission?.status, done.mission?.summary).toBe('finished');
    const applyCards = h.cards.filter((c) => c.toolName === 'dev_apply_task');
    const buildCards = h.cards.filter((c) => c.toolName === 'dev_build_project');
    expect(applyCards, JSON.stringify(applyCards.map((c) => c.title))).toHaveLength(0);
    expect(buildCards, JSON.stringify(buildCards.map((c) => c.title))).toHaveLength(0);
    expect(h.ran.some((r) => r.display.includes('dotnet publish'))).toBe(true);
    await h.instance.discardTask();
  }, 180_000);

  it('Construire manuel : la carte reste obligatoire', async () => {
    const title = 'Manuel Build';
    const core = 'ManuelBuild';
    fake.scripts.set(CODE, missionScript({
      factoryName: title,
      plan: [{ path: `src/${core}.Core/Salutation.cs`, action: 'modifier' }],
      writes: { [`src/${core}.Core/Salutation.cs`]: SALUTATION_CS(core) },
    }));
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE, projectsRoot },
      intercept: offlineDotnet(true),
    });
    await h.instance.validate(jarvis);
    const done = await h.instance.startMission(
      'new-project',
      'Appli Windows .exe minimaliste.',
      true,
    );
    const projectId = done.mission!.projectId!;
    await h.instance.discardTask();
    h.cards.length = 0;
    await h.instance.buildProject(projectId);
    expect(h.cards.some((c) => c.toolName === 'dev_build_project')).toBe(true);
  }, 180_000);

  it('appli .exe : mission → fusion → publish win-x64 sur disque', async () => {
    const title = 'Compteur Mots';
    const core = 'CompteurMots';
    fake.scripts.set(CODE, missionScript({
      factoryName: title,
      plan: [
        { path: `src/${core}.Core/Salutation.cs`, action: 'modifier' },
        { path: `src/${core}.Core/WordCounter.cs`, action: 'creer' },
        { path: `tests/${core}.Tests/WordCounterTests.cs`, action: 'creer' },
      ],
      writes: {
        [`src/${core}.Core/Salutation.cs`]: SALUTATION_CS(core),
        [`src/${core}.Core/WordCounter.cs`]:
          'namespace CompteurMots.Core;\npublic sealed class WordCounter { public int Count(string? text) => string.IsNullOrWhiteSpace(text) ? 0 : text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length; }\n',
        [`tests/${core}.Tests/WordCounterTests.cs`]:
          'namespace CompteurMots.Tests;\npublic class WordCounterTests { [Fact] public void Vide() { Assert.Equal(0, new CompteurMots.Core.WordCounter().Count("")); } [Fact] public void Deux() { Assert.Equal(2, new CompteurMots.Core.WordCounter().Count("a b")); } }\n',
      },
    }));
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE, projectsRoot },
      intercept: offlineDotnet(true),
    });
    await h.instance.validate(jarvis);
    const done = await h.instance.startMission(
      'new-project',
      'Crée une application Windows de bureau livrée en .exe : un compteur de mots dans Core, testé par xUnit.',
      true,
    );
    expect(done.mission?.status, done.mission?.summary).toBe('finished');
    expect(done.codeTask?.report?.verdict).toBe('success');
    expect(h.cards.some((c) => c.toolName === 'dev_apply_task')).toBe(false);
    expect(h.cards.some((c) => c.toolName === 'dev_build_project')).toBe(false);
    expect(h.ran.some((r) => r.display.includes('dotnet publish'))).toBe(true);
    assertExeAndTests(title, done.mission!.projectId!);
    await h.instance.discardTask();
  }, 180_000);

  it('deuxième appli .exe simple : chronomètre Core', async () => {
    const title = 'Chrono Simple';
    const core = 'ChronoSimple';
    fake.scripts.set(CODE, missionScript({
      factoryName: title,
      plan: [
        { path: `src/${core}.Core/Salutation.cs`, action: 'modifier' },
        { path: `src/${core}.Core/StopwatchCore.cs`, action: 'creer' },
        { path: `tests/${core}.Tests/StopwatchCoreTests.cs`, action: 'creer' },
      ],
      writes: {
        [`src/${core}.Core/Salutation.cs`]: SALUTATION_CS(core),
        [`src/${core}.Core/StopwatchCore.cs`]:
          'namespace ChronoSimple.Core;\npublic sealed class StopwatchCore { private int _ticks; public void Tick() => _ticks++; public int Ticks => _ticks; public void Reset() => _ticks = 0; }\n',
        [`tests/${core}.Tests/StopwatchCoreTests.cs`]:
          'namespace ChronoSimple.Tests;\npublic class StopwatchCoreTests { [Fact] public void Zero() { var s = new ChronoSimple.Core.StopwatchCore(); Assert.Equal(0, s.Ticks); } [Fact] public void Deux() { var s = new ChronoSimple.Core.StopwatchCore(); s.Tick(); s.Tick(); Assert.Equal(2, s.Ticks); } }\n',
      },
    }));
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE, projectsRoot },
      intercept: offlineDotnet(true),
    });
    await h.instance.validate(jarvis);
    const done = await h.instance.startMission(
      'new-project',
      'Nouvelle appli Windows .exe : un chronomètre simple (ticks) dans Core avec tests.',
      true,
    );
    expect(done.mission?.status, done.mission?.summary).toBe('finished');
    assertExeAndTests(title, done.mission!.projectId!);
    await h.instance.discardTask();
  }, 180_000);

  it('formulation courante sans .exe : « fais-moi une appli Windows » → publish', async () => {
    const title = 'Lignes Notes';
    const core = 'LignesNotes';
    fake.scripts.set(CODE, missionScript({
      factoryName: title,
      plan: [
        { path: `src/${core}.Core/Salutation.cs`, action: 'modifier' },
        { path: `src/${core}.Core/LineCounter.cs`, action: 'creer' },
        { path: `tests/${core}.Tests/LineCounterTests.cs`, action: 'creer' },
      ],
      writes: {
        [`src/${core}.Core/Salutation.cs`]: SALUTATION_CS(core),
        [`src/${core}.Core/LineCounter.cs`]:
          "namespace LignesNotes.Core;\npublic sealed class LineCounter { public int Count(string? text) => string.IsNullOrEmpty(text) ? 0 : text.Split('\\n').Length; }\n",
        [`tests/${core}.Tests/LineCounterTests.cs`]:
          'namespace LignesNotes.Tests;\npublic class LineCounterTests { [Fact] public void Une() { Assert.Equal(1, new LignesNotes.Core.LineCounter().Count("a")); } [Fact] public void Trois() { Assert.Equal(3, new LignesNotes.Core.LineCounter().Count("a\\nb\\nc")); } }\n',
      },
    }));
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE, projectsRoot },
      intercept: offlineDotnet(true),
    });
    await h.instance.validate(jarvis);
    const done = await h.instance.startMission(
      'new-project',
      'Fais-moi une appli Windows : une classe dans Core qui compte les lignes d’un texte, avec tests.',
      true,
    );
    expect(done.mission?.status, done.mission?.summary).toBe('finished');
    expect(h.cards.some((c) => c.toolName === 'dev_apply_task')).toBe(false);
    assertExeAndTests(title, done.mission!.projectId!);
    await h.instance.discardTask();
  }, 180_000);

  it('« un programme sur le bureau » → même chemin publish', async () => {
    const title = 'Taches Jour';
    const core = 'TachesJour';
    fake.scripts.set(CODE, missionScript({
      factoryName: title,
      plan: [
        { path: `src/${core}.Core/Salutation.cs`, action: 'modifier' },
        { path: `src/${core}.Core/TaskTotal.cs`, action: 'creer' },
        { path: `tests/${core}.Tests/TaskTotalTests.cs`, action: 'creer' },
      ],
      writes: {
        [`src/${core}.Core/Salutation.cs`]: SALUTATION_CS(core),
        [`src/${core}.Core/TaskTotal.cs`]:
          'namespace TachesJour.Core;\npublic sealed class TaskTotal { public int Add(int a, int b) => a + b; }\n',
        [`tests/${core}.Tests/TaskTotalTests.cs`]:
          'namespace TachesJour.Tests;\npublic class TaskTotalTests { [Fact] public void Somme() { Assert.Equal(5, new TachesJour.Core.TaskTotal().Add(2, 3)); } }\n',
      },
    }));
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE, projectsRoot },
      intercept: offlineDotnet(true),
    });
    await h.instance.validate(jarvis);
    const done = await h.instance.startMission(
      'new-project',
      'Un programme sur le bureau : addition de deux entiers dans Core, testé.',
      true,
    );
    expect(done.mission?.status, done.mission?.summary).toBe('finished');
    expect(h.ran.some((r) => r.display.includes('dotnet publish'))).toBe(true);
    assertExeAndTests(title, done.mission!.projectId!);
    await h.instance.discardTask();
  }, 180_000);
});
