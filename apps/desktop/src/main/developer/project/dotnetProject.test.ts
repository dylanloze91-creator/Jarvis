import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EDIT_MARKER,
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

const base = mkdtempSync(join(tmpdir(), 'jarvis-dotnet-'));
const jarvis = join(base, 'Jarvis');
const projectsRoot = join(base, 'Projets');
const CODE = 'scripte:dotnet';
const fake = new FakeOllama();
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const system = (body: ChatBody) => body.messages.find((m) => m.role === 'system')?.content ?? '';

const BLOCKER = `namespace BloqueurDeSites.Core;

/// <summary>Ajoute des sites bloqués à un fichier hosts dont le chemin est réglable.</summary>
public sealed class HostsBlocker(string hostsPath)
{
    public const string WindowsHosts = @"C:\\Windows\\System32\\drivers\\etc\\hosts";

    public void Block(string site) => File.AppendAllText(hostsPath, $"127.0.0.1 {site}{Environment.NewLine}");
}
`;

const TEST_CS =
  'namespace BloqueurDeSites.Tests;\npublic class HostsBlockerTests { [Fact] public void BloqueDansUnFauxFichier() { var p = Path.GetTempFileName(); new BloqueurDeSites.Core.HostsBlocker(p).Block("x.com"); Assert.Contains("x.com", File.ReadAllText(p)); } }\n';

function script(body: ChatBody): Reply {
  const text = system(body);
  const done = body.messages.filter((m) => m.role === 'tool').length;
  const write = text.includes(WRITE_MARKER) ? writeRequest(body) : null;
  if (write?.path === 'src/BloqueurDeSites.Core/HostsBlocker.cs') return codeBlock(BLOCKER);
  if (write?.path === 'tests/BloqueurDeSites.Tests/HostsBlockerTests.cs') return codeBlock(TEST_CS);
  if (text.includes(GOAL_MARKER))
    return {
      content: JSON.stringify({
        goal: 'Une appli Windows qui bloque des sites dans un fichier hosts réglable.',
        questions: [],
        criteria: ['tests sur un faux fichier hosts'],
      }),
    };
  if (text.includes(FACTORY_MARKER))
    return {
      content: JSON.stringify({
        template: 'winforms',
        name: 'Bloqueur de sites',
        description: 'Bloque des sites.',
      }),
    };
  if (text.includes(PLAN_MARKER))
    return {
      content: JSON.stringify({
        resume: 'Classe HostsBlocker et son test sur un faux fichier.',
        fichiers: [
          { chemin: 'src/BloqueurDeSites.Core/HostsBlocker.cs', action: 'creer' },
          { chemin: 'tests/BloqueurDeSites.Tests/HostsBlockerTests.cs', action: 'creer' },
        ],
        tests: ['test'],
      }),
    };
  if (text.includes(EDIT_MARKER)) {
    const steps = [
      {
        name: 'dev_create_file',
        arguments: { path: 'src/BloqueurDeSites.Core/HostsBlocker.cs', content: BLOCKER },
      },
      {
        name: 'dev_create_file',
        arguments: {
          path: 'tests/BloqueurDeSites.Tests/HostsBlockerTests.cs',
          content:
            'namespace BloqueurDeSites.Tests;\npublic class HostsBlockerTests { [Fact] public void BloqueDansUnFauxFichier() { var p = Path.GetTempFileName(); new BloqueurDeSites.Core.HostsBlocker(p).Block("x.com"); Assert.Contains("x.com", File.ReadAllText(p)); } }\n',
        },
      },
    ];
    return steps[done] ? { call: steps[done]! } : { content: 'Fait.' };
  }
  if (text.includes(REVIEW_MARKER)) return { content: '{"verdict": "ok", "issues": []}' };
  return { content: 'Je ne sais pas.' };
}

/** dotnet hors ligne : SDK 10 annoncé, restauration, compilation et tests simulés. */
function offlineDotnet(sdk: boolean) {
  return (spec: RunSpec, display: string): RunOutcome | null => {
    if (!display.startsWith('dotnet ')) return null;
    if (display === 'dotnet --list-sdks')
      return sdk
        ? fakeOutcome(display, '10.0.112 [/usr/lib/dotnet/sdk]\n')
        : { ...fakeOutcome(display, '', 0), code: null, error: 'spawn dotnet ENOENT' };
    if (display.startsWith('dotnet restore')) return fakeOutcome(display, 'Restored.');
    if (display.startsWith('dotnet build')) return fakeOutcome(display, 'Build succeeded.');
    if (display.startsWith('dotnet test')) {
      const extra = existsSync(
        join(spec.cwd, 'tests', 'BloqueurDeSites.Tests', 'HostsBlockerTests.cs'),
      );
      return fakeOutcome(
        display,
        `Passed!  - Failed:     0, Passed:     ${extra ? 3 : 2}, Skipped:     0, Total:     ${extra ? 3 : 2}, Duration: 9 ms - BloqueurDeSites.Tests.dll (net10.0)\n`,
      );
    }
    return null;
  };
}

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(jarvis);
  await fake.start();
  fake.installed.set(CODE, 3e9);
  fake.scripts.set(CODE, script);
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

describe('appli Windows (.NET), 0.5.4', () => {
  it('« Nouveau projet » WinForms : gabarit .NET, dotnet restore, boucle avec dotnet build/test, revue du fichier hosts', async () => {
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
      'Crée une appli Windows qui bloque des sites dans le fichier hosts.',
      true,
    );
    const mission = done.mission!;
    expect(mission.status, mission.summary ?? '').toBe('finished');
    expect(mission.projectId).toBe('bloqueur-de-sites');
    const dir = join(projectsRoot, 'bloqueur-de-sites');
    expect(existsSync(join(dir, 'BloqueurDeSites.sln'))).toBe(true);
    const app = readFileSync(
      join(dir, 'src', 'BloqueurDeSites.App', 'BloqueurDeSites.App.csproj'),
      'utf8',
    );
    expect(app).toContain('<UseWindowsForms>true</UseWindowsForms>');
    expect(app).toContain('<TargetFramework>net10.0-windows</TargetFramework>');
    expect(git(dir, 'log', '--format=%an')).toBe('Jarvis Développeur');

    const create = h.cards.find((c) => c.toolName === 'dev_create_project')!;
    expect(create.command).toContain('dotnet restore BloqueurDeSites.sln');
    expect(create.safety.reasons).toContain('réseau : dotnet restore (paquets NuGet)');
    expect(h.cards.find((c) => c.toolName === 'dev_install_sandbox')?.command).toContain(
      'dotnet restore BloqueurDeSites.sln',
    );

    const task = done.codeTask!;
    expect(task.plan?.testCommands).toEqual([
      'dotnet build BloqueurDeSites.sln --no-restore',
      'dotnet test BloqueurDeSites.sln --no-restore',
    ]);
    expect(task.plan?.installCommand).toBe('dotnet restore BloqueurDeSites.sln');
    expect(task.runs.at(-1)?.results.map((r) => r.summary)).toEqual(['réussi', '3 tests réussis']);
    expect(task.findings.map((f) => `${f.category}:${f.file}`)).toEqual([
      'system:src/BloqueurDeSites.Core/HostsBlocker.cs',
    ]);
    const review = h.cards.find((c) => c.toolName === 'dev_review_diff')!;
    expect(review.findings?.[0]?.reason).toMatch(/faux fichier/);

    const tests = h.ran.filter((r) => r.display === 'dotnet test BloqueurDeSites.sln --no-restore');
    expect(tests.length).toBeGreaterThan(0);
    expect(new Set(tests.map((r) => r.level))).toEqual(new Set(['auto']));
    expect(h.ran.some((r) => /dotnet (run|publish|nuget)/.test(r.display))).toBe(false);

    const projects = (await h.instance.listProjects()).projects!;
    expect(projects.find((p) => p.id === 'bloqueur-de-sites')).toMatchObject({
      kind: 'dotnet',
      template: 'dotnet-winforms',
      ok: true,
      build: { command: 'dotnet build BloqueurDeSites.sln -c Release', artifact: null },
    });
    await h.instance.discardTask();
  }, 180_000);

  it('importer un dossier .NET existant ; SDK absent : import refusé avec la commande à lancer soi-même', async () => {
    const dir = join(base, 'MonOutil');
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(
      join(dir, 'MonOutil.sln'),
      '\nMicrosoft Visual Studio Solution File, Format Version 12.00\n',
    );
    writeFileSync(
      join(dir, 'tests', 'MonOutil.Tests.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" /></ItemGroup></Project>\n',
    );
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(
      dir,
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

    const missing = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE },
      intercept: offlineDotnet(false),
    });
    const refused = await missing.instance.importProject(dir);
    expect(refused.notice).toMatch(/SDK \.NET : introuvable/);

    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE },
      intercept: offlineDotnet(true),
    });
    const imported = await h.instance.importProject(dir);
    expect(imported.notice).toMatch(/« MonOutil » importé/);
    expect(imported.projects?.find((p) => p.name === 'MonOutil')).toMatchObject({
      kind: 'dotnet',
      origin: 'imported',
      ok: true,
    });
    expect(imported.dotnet).toEqual({ sdks: ['10.0.112'], hint: null });
  }, 60_000);

  it('« Nouveau projet » .NET sans SDK : rien n’est écrit, message clair', async () => {
    const root = join(base, 'Projets-sans-sdk');
    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE, projectsRoot: root },
      intercept: offlineDotnet(false),
    });
    await h.instance.validate(jarvis);
    const done = await h.instance.startMission('new-project', 'Crée une appli Windows.', true);
    expect(done.mission?.status).toBe('failed');
    expect(done.mission?.summary).toMatch(/SDK \.NET \(8 ou plus\) est introuvable/);
    expect(h.cards.some((c) => c.toolName === 'dev_create_project')).toBe(false);
    expect(existsSync(root)).toBe(false);
  }, 60_000);
});
