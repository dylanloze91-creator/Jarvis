import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FACTORY_MARKER,
  GOAL_MARKER,
  PLAN_MARKER,
  REVIEW_MARKER,
  parseDotnetSdks,
} from '@jarvis/core';
import { createHarness, fakeOutcome } from '../controllerHarness.testkit.js';
import {
  dotnetDesktopTfm,
  fakeDotnetListSdks,
  installedDotnetTarget,
} from '../dotnetTestkit.js';
import { FakeOllama, type ChatBody, type Reply } from '../models/fakeOllama.testkit.js';
import type { RunOutcome, RunSpec } from '../runner.js';
import { codeBlock, createFixtureRepo, writeRequest } from '../task/taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-dotnet-'));
const jarvis = join(base, 'Jarvis');
const projectsRoot = join(base, 'Projets');
const DOTNET_TFM = installedDotnetTarget() ?? 'net8.0';
const DOTNET_DESKTOP = dotnetDesktopTfm(DOTNET_TFM);
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
  const write = writeRequest(body);
  // La boucle d’outils demande le fichier dans le message, pas via le marqueur d’écriture.
  if (text.includes(PLAN_MARKER)) {
    const planJson = JSON.stringify({
        resume: 'Classe HostsBlocker et son test sur un faux fichier.',
        fichiers: [
          { chemin: 'src/BloqueurDeSites.Core/Salutation.cs', action: 'modifier' },
          { chemin: 'src/BloqueurDeSites.Core/HostsBlocker.cs', action: 'creer' },
          { chemin: 'tests/BloqueurDeSites.Tests/HostsBlockerTests.cs', action: 'creer' },
        ],
        tests: ['test'],
      });
    return { content: planJson };
  }
  if (text.includes(FACTORY_MARKER))
    return {
      content: JSON.stringify({
        template: 'winforms',
        name: 'Bloqueur de sites',
        description: 'Bloque des sites.',
      }),
    };
  if (text.includes(GOAL_MARKER))
    return {
      content: JSON.stringify({
        goal: 'Une appli Windows qui bloque des sites dans un fichier hosts réglable.',
        questions: [],
        criteria: ['tests sur un faux fichier hosts'],
      }),
    };
  if (text.includes(REVIEW_MARKER)) return { content: '{"verdict": "ok", "issues": []}' };
  if (write?.path === 'src/BloqueurDeSites.Core/Salutation.cs')
    return codeBlock(
      `namespace BloqueurDeSites.Core;\npublic static class Salutation { public static string Bonjour(string? p) => "Bonjour"; }\n`,
    );
  if (write?.path === 'src/BloqueurDeSites.Core/HostsBlocker.cs') return codeBlock(BLOCKER);
  if (write?.path === 'tests/BloqueurDeSites.Tests/HostsBlockerTests.cs')
    return codeBlock(TEST_CS);
  return { content: 'Je ne sais pas.' };
}

/** dotnet hors ligne : SDK annoncé selon la machine, restauration, compilation et tests simulés. */
function stubPublishExe(spec: RunSpec): void {
  const slnName = readdirSync(spec.cwd).find((f) => f.endsWith('.sln'));
  if (!slnName) return;
  const slnBase = slnName.replace(/\.sln$/i, '');
  const exeRel = `src/${slnBase}.App/bin/Release/${DOTNET_DESKTOP}/win-x64/publish/${slnBase}.App.exe`;
  const exe = join(spec.cwd, exeRel);
  mkdirSync(dirname(exe), { recursive: true });
  writeFileSync(exe, Buffer.alloc(12_000, 0x4d));
}

function offlineDotnet(sdk: boolean) {
  return (spec: RunSpec, display: string): RunOutcome | null => {
    if (!display.startsWith('dotnet ')) return null;
    if (display === 'dotnet --list-sdks')
      return sdk
        ? fakeOutcome(display, fakeDotnetListSdks(DOTNET_TFM))
        : { ...fakeOutcome(display, '', 0), code: null, error: 'spawn dotnet ENOENT' };
    if (display.startsWith('dotnet restore')) return fakeOutcome(display, 'Restored.');
    if (display.startsWith('dotnet build')) return fakeOutcome(display, 'Build succeeded.');
    if (display.startsWith('dotnet publish')) {
      stubPublishExe(spec);
      return fakeOutcome(display, 'Build succeeded.\n');
    }
    if (display.startsWith('dotnet test')) {
      const extra = existsSync(
        join(spec.cwd, 'tests', 'BloqueurDeSites.Tests', 'HostsBlockerTests.cs'),
      );
      return fakeOutcome(
        display,
        `Passed!  - Failed:     0, Passed:     ${extra ? 3 : 2}, Skipped:     0, Total:     ${extra ? 3 : 2}, Duration: 9 ms - BloqueurDeSites.Tests.dll (${DOTNET_TFM})\n`,
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
  fake.scripts.set('qwen2.5:3b', script);
});
afterAll(async () => {
  await fake.stop();
  // Windows : `dotnet build` garde parfois un dossier verrouillé quelques instants après la fin
  // (EBUSY sur rmdir). On réessaie, et un dossier temporaire qui reste ne fait pas échouer la suite.
  try {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // dossier temporaire laissé à Windows
  }
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
    expect(app).toContain(`<TargetFramework>${DOTNET_DESKTOP}</TargetFramework>`);
    expect(
      git(dir, 'log', '--format=%an')
        .split('\n')
        .every((a) => a === 'Jarvis Développeur'),
    ).toBe(true);

    expect(h.cards.some((c) => c.toolName === 'dev_create_project')).toBe(false);
    expect(
      h.ran.some((r) => r.display === 'dotnet restore BloqueurDeSites.sln'),
    ).toBe(true);

    const task = done.codeTask!;
    expect(task.plan?.testCommands).toEqual([
      'dotnet build BloqueurDeSites.sln --no-restore',
      'dotnet test BloqueurDeSites.sln --no-restore',
    ]);
    expect(task.plan?.installCommand).toBe('dotnet restore BloqueurDeSites.sln');
    expect(task.runs.at(-1)?.results.map((r) => r.summary)).toEqual([
      'réussi',
      expect.stringMatching(/\d+ tests réussis/),
    ]);
    expect(task.findings.map((f) => `${f.category}:${f.file}`)).toEqual([
      'system:src/BloqueurDeSites.Core/HostsBlocker.cs',
    ]);
    expect(task.findings[0]?.reason).toMatch(/faux fichier/);

    const tests = h.ran.filter((r) => r.display === 'dotnet test BloqueurDeSites.sln --no-restore');
    expect(tests.length).toBeGreaterThan(0);
    expect(new Set(tests.map((r) => r.level))).toEqual(new Set(['auto']));
    expect(h.ran.some((r) => r.display.startsWith('dotnet publish'))).toBe(true);
    const exeRel = `src/BloqueurDeSites.App/bin/Release/${DOTNET_DESKTOP}/win-x64/publish/BloqueurDeSites.App.exe`;
    expect(existsSync(join(dir, exeRel))).toBe(true);

    const projects = (await h.instance.listProjects()).projects!;
    expect(projects.find((p) => p.id === 'bloqueur-de-sites')).toMatchObject({
      kind: 'dotnet',
      template: 'dotnet-winforms',
      ok: true,
      build: {
        command:
          'dotnet publish src/BloqueurDeSites.App/BloqueurDeSites.App.csproj -c Release -r win-x64 --no-self-contained',
        artifact:
          `src/BloqueurDeSites.App/bin/Release/${DOTNET_DESKTOP}/win-x64/publish/BloqueurDeSites.App.exe`,
      },
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
    expect(refused.developerBulletin).toMatch(/SDK \.NET : introuvable/);

    const h = createHarness({
      base,
      repo: jarvis,
      fake,
      developer: { codeModel: CODE },
      intercept: offlineDotnet(true),
    });
    const imported = await h.instance.importProject(dir);
    expect(imported.developerBulletin).toMatch(/« MonOutil » importé/);
    expect(imported.projects?.find((p) => p.name === 'MonOutil')).toMatchObject({
      kind: 'dotnet',
      origin: 'imported',
      ok: true,
    });
    expect(imported.dotnet).toEqual({
      sdks: parseDotnetSdks(fakeDotnetListSdks(DOTNET_TFM)),
      hint: null,
    });
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
    const done = await h.instance.startMission(
      'new-project',
      'Crée une appli Windows bureau livrée en .exe.',
      true,
    );
    expect(done.mission?.status).toBe('failed');
    expect(done.mission?.summary).toMatch(/SDK \.NET \(8 ou plus\) est introuvable/);
    expect(h.cards.some((c) => c.toolName === 'dev_create_project')).toBe(false);
    await h.instance.listProjects();
    await new Promise((r) => setTimeout(r, 80));
    const entries = existsSync(root) ? readdirSync(root) : [];
    expect(entries.length).toBeLessThanOrEqual(1);
    for (const id of entries) {
      expect(existsSync(join(root, id, 'BloqueurDeSites.sln'))).toBe(false);
      expect(existsSync(join(root, id, 'package.json'))).toBe(false);
    }
  }, 60_000);
});
