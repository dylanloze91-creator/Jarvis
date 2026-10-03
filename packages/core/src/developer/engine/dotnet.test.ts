import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../commandSafety.js';
import { scanDiff, scanLine } from '../diffScan.js';
import { suiteCommand, suiteCommandFor } from '../taskPlan.js';
import { compareRuns, parseDotnetOutput, type TestRunSummary } from '../testOutput.js';
import { parsePlanReply, planSystemPrompt } from '../taskPrompts.js';
import {
  DOTNET_TEMPLATE_IDS,
  dotnetIdentifier,
  renderDotnetTemplate,
  stableGuid,
} from './dotnetTemplates.js';
import { JARVIS_PROJECT_PROFILE } from './profiles/jarvis.js';
import {
  createDotnetProfile,
  dotnetProtectedReason,
  dotnetTargetFramework,
  parseDotnetSdks,
} from './profiles/dotnet.js';
import { factorySchema, renderTemplate, templateToolchain } from './templates.js';

const sandbox = { insideSandbox: true, branch: 'jarvis-dev/2026-10-03-x' };
const level = (command: string, ctx = sandbox) => classifyCommand(command, ctx).level;

describe('tri des commandes dotnet (0.5.4)', () => {
  it('compiler et tester : automatiques dans la copie isolée sous la forme exacte seulement', () => {
    expect(level('dotnet build App.sln --no-restore')).toBe('auto');
    expect(level('dotnet test App.sln --no-restore')).toBe('auto');
    expect(level('dotnet test src/App/App.csproj --no-restore')).toBe('auto');
    expect(level('dotnet build App.sln --no-restore', {})).toBe('confirm');
    expect(level('dotnet build App.sln')).toBe('always-confirm');
    expect(level('dotnet build App.sln -c Release')).toBe('always-confirm');
    expect(level('dotnet test ../autre/App.sln --no-restore')).toBe('always-confirm');
    expect(level('dotnet test App.sln --no-restore && del x')).not.toBe('auto');
  });

  it('réseau, lancement et installation redemandent ; publication et MSBuild direct refusés', () => {
    expect(level('dotnet restore App.sln')).toBe('always-confirm');
    expect(level('dotnet add src/App package Newtonsoft.Json')).toBe('always-confirm');
    expect(level('dotnet run --project src/App')).toBe('always-confirm');
    expect(level('dotnet publish -c Release')).toBe('always-confirm');
    expect(level('dotnet tool install -g x')).toBe('always-confirm');
    expect(level('dotnet new winforms')).toBe('always-confirm');
    expect(level('dotnet nuget push x.nupkg')).toBe('denied');
    expect(level('dotnet nuget delete x 1.0')).toBe('denied');
    expect(level('dotnet msbuild App.sln')).toBe('denied');
    expect(level('dotnet user-secrets set k v')).toBe('denied');
    expect(level('dotnet --list-sdks')).toBe('confirm');
    expect(level('dotnet x.dll')).toBe('always-confirm');
    expect(level('msbuild App.sln')).toBe('denied');
  });
});

const TEST_FAIL = `  Lib -> /tmp/s/src/Lib/bin/Debug/net10.0/Lib.dll
Test run for /tmp/s/tests/Lib.Tests/bin/Debug/net10.0/Lib.Tests.dll (.NETCoreApp,Version=v10.0)
[xUnit.net 00:00:00.17]     Lib.Tests.CalcTests.AddFails [FAIL]
  Failed Lib.Tests.CalcTests.AddFails [5 ms]
  Error Message:
   Assert.Equal() Failure: Values differ

Failed!  - Failed:     1, Passed:     1, Skipped:     0, Total:     2, Duration: 29 ms - Lib.Tests.dll (net10.0)`;
const TEST_OK =
  'Passed!  - Failed:     0, Passed:     2, Skipped:     0, Total:     2, Duration: 18 ms - Lib.Tests.dll (net10.0)';
const BUILD_FAIL = `/tmp/s/src/Lib/Broken.cs(1,35): error CS1002: ; expected [/tmp/s/src/Lib/Lib.csproj]

Build FAILED.

/tmp/s/src/Lib/Broken.cs(1,35): error CS1002: ; expected [/tmp/s/src/Lib/Lib.csproj]
    0 Warning(s)
    1 Error(s)`;

describe('sorties dotnet build / dotnet test (capturées sur le SDK 10)', () => {
  it('tests échoués par nom, total des séries', () => {
    expect(parseDotnetOutput(TEST_FAIL, { exitCode: 1, root: '/tmp/s' })).toEqual({
      failures: ['test Lib.Tests.CalcTests.AddFails'],
      summary: '1 test(s) échoué(s) sur 2',
    });
    expect(parseDotnetOutput(TEST_OK, { exitCode: 0 })).toEqual({
      failures: [],
      summary: '2 tests réussis',
    });
  });

  it('erreurs de compilation : fichier relatif et code, une seule fois', () => {
    expect(parseDotnetOutput(BUILD_FAIL, { exitCode: 1, root: '/tmp/s' })).toEqual({
      failures: ['build src/Lib/Broken.cs CS1002 ; expected'],
      summary: '1 erreur(s) de compilation',
    });
    expect(
      parseDotnetOutput('MSBUILD : error MSB1009: Project file does not exist.', { exitCode: 1 })
        .failures,
    ).toEqual(['build MSB1009 Project file does not exist.']);
    expect(parseDotnetOutput('Build succeeded.', { exitCode: 0 }).summary).toBe('réussi');
  });

  it('un échec déjà là avant la tâche ne lui est pas imputé', () => {
    const run = (failures: string[]): TestRunSummary => ({
      suite: 'test',
      command: 'dotnet test App.sln --no-restore',
      exitCode: failures.length ? 1 : 0,
      failures,
      summary: '',
      excerpt: '',
      durationMs: 1,
      timedOut: false,
    });
    const before = [run(['test Lib.Tests.CalcTests.AddFails'])];
    expect(compareRuns(before, [run(['test Lib.Tests.CalcTests.AddFails'])]).ok).toBe(true);
    expect(compareRuns(before, [run(['test Lib.Tests.CalcTests.New'])]).newFailures).toEqual([
      'test: test Lib.Tests.CalcTests.New',
    ]);
  });
});

describe('revue du diff : motifs C# et MSBuild', () => {
  const cats = (file: string, text: string) => scanLine(file, 1, text).map((f) => f.category);
  it('processus, suppression, réseau, code dynamique', () => {
    expect(cats('src/A.cs', 'Process.Start("notepad.exe");')).toEqual(['process']);
    expect(cats('src/A.cs', 'File.Delete(chemin);')).toEqual(['delete']);
    expect(cats('src/A.cs', 'using var http = new HttpClient();')).toEqual(['network']);
    expect(cats('src/A.cs', 'var a = Assembly.LoadFrom(dll);')).toEqual(['dynamic']);
    expect(cats('src/A.csproj', '<Exec Command="curl x" />')).toEqual(['process']);
  });

  it('fichier hosts, registre, administrateur : catégorie « système »', () => {
    expect(
      cats('src/A.cs', 'const string Hosts = @"C:\\Windows\\System32\\drivers\\etc\\hosts";'),
    ).toEqual(['system']);
    expect(cats('src/A.cs', 'Registry.LocalMachine.OpenSubKey("x");')).toEqual(['system']);
    expect(
      cats('src/app.manifest', '<requestedExecutionLevel level="requireAdministrator" />'),
    ).toEqual(['system']);
    expect(cats('src/A.cs', 'var info = new ProcessStartInfo(exe) { Verb = "runas" };')).toEqual([
      'process',
      'system',
    ]);
  });

  it('espaces de noms XAML et code sans risque : rien ; TypeScript inchangé', () => {
    expect(
      cats('src/App.xaml', 'xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"'),
    ).toEqual([]);
    expect(cats('src/A.cs', 'public static string Bonjour(string nom) => nom;')).toEqual([]);
    expect(cats('src/a.ts', 'Process.Start("x"); File.Delete(p);')).toEqual([]);
    expect(
      scanDiff(
        'diff --git a/src/A.cs b/src/A.cs\n--- a/src/A.cs\n+++ b/src/A.cs\n@@ -0,0 +1 @@\n+Directory.Delete(dossier, true);\n',
      ).map((f) => f.category),
    ).toEqual(['delete']);
  });
});

describe('profil .NET', () => {
  const profile = createDotnetProfile({
    id: 'bloqueur',
    name: 'Bloqueur de sites',
    target: 'BloqueurDeSites.sln',
  });

  it('compilation et tests sur la solution, restauration NuGet, consignes', () => {
    expect(suiteCommandFor(profile, 'typecheck')).toBe(
      'dotnet build BloqueurDeSites.sln --no-restore',
    );
    expect(suiteCommandFor(profile, 'test')).toBe('dotnet test BloqueurDeSites.sln --no-restore');
    expect(suiteCommandFor(JARVIS_PROJECT_PROFILE, 'test')).toBe(suiteCommand('test'));
    expect(profile.install).toEqual({
      program: 'dotnet',
      args: ['restore', 'BloqueurDeSites.sln'],
    });
    const prompt = planSystemPrompt(profile);
    expect(prompt).toContain('application .NET (C#)');
    expect(prompt).toContain(
      '"typecheck" (Compilation (dotnet build)), "test" (Tests (dotnet test))',
    );
    expect(prompt).toContain('Aucun droit administrateur');
    expect(prompt).toContain('fichier temporaire');
    const plan = parsePlanReply(
      JSON.stringify({
        resume: 'x',
        fichiers: [{ chemin: 'src/A.cs', action: 'creer' }],
        tests: ['lint'],
      }),
      profile,
    );
    expect(plan.tests).toEqual(['typecheck', 'test']);
    for (const cmd of ['typecheck', 'test'] as const)
      expect(level(suiteCommandFor(profile, cmd))).toBe('auto');
  });

  it('projet, solution, NuGet et manifeste : toujours confirmés', () => {
    expect(dotnetProtectedReason('src/App/App.csproj')).toMatch(/MSBuild/);
    expect(dotnetProtectedReason('BloqueurDeSites.sln')).toMatch(/MSBuild/);
    expect(dotnetProtectedReason('Directory.Build.props')).toMatch(/MSBuild/);
    expect(dotnetProtectedReason('nuget.config')).toMatch(/NuGet/);
    expect(dotnetProtectedReason('src/App/app.manifest')).toMatch(/droits/);
    expect(dotnetProtectedReason('src/App.Core/HostsBlocker.cs')).toBeNull();
  });

  it('SDK : versions lues, cible = plus récent SDK stable, 8 au moins', () => {
    const sdks = parseDotnetSdks(
      '8.0.404 [C:\\Program Files\\dotnet\\sdk]\r\n10.0.112 [C:\\Program Files\\dotnet\\sdk]\r\n11.0.100-preview.1 [x]\r\n',
    );
    expect(sdks).toEqual(['8.0.404', '10.0.112', '11.0.100-preview.1']);
    expect(dotnetTargetFramework(sdks)).toBe('net10.0');
    expect(dotnetTargetFramework(['6.0.400'])).toBeNull();
    expect(dotnetTargetFramework([])).toBeNull();
  });
});

describe('gabarits .NET', () => {
  it('noms C# valides tirés du titre', () => {
    expect(dotnetIdentifier('Bloqueur de sites')).toBe('BloqueurDeSites');
    expect(dotnetIdentifier('Éditeur 3D')).toBe('Editeur3D');
    expect(dotnetIdentifier('3D rapide')).toBe('Projet3DRapide');
    expect(stableGuid('a')).toBe(stableGuid('a'));
    expect(stableGuid('a')).not.toBe(stableGuid('b'));
    expect(stableGuid('a')).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/,
    );
  });

  it.each(DOTNET_TEMPLATE_IDS)(
    '%s : solution, Core, application, tests xUnit, sans élévation',
    (id) => {
      const files = renderDotnetTemplate(id, {
        name: 'BloqueurDeSites',
        title: 'Bloqueur de sites',
        description: 'Bloque des sites',
        tfm: 'net10.0',
      });
      const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
      expect(Object.keys(byPath)).toEqual(
        expect.arrayContaining([
          'BloqueurDeSites.sln',
          'src/BloqueurDeSites.Core/BloqueurDeSites.Core.csproj',
          'src/BloqueurDeSites.App/BloqueurDeSites.App.csproj',
          'tests/BloqueurDeSites.Tests/BloqueurDeSites.Tests.csproj',
          'tests/BloqueurDeSites.Tests/SalutationTests.cs',
          'README.md',
          '.gitignore',
        ]),
      );
      expect(byPath['BloqueurDeSites.sln']).toContain(
        '"src\\BloqueurDeSites.Core\\BloqueurDeSites.Core.csproj"',
      );
      expect(byPath['src/BloqueurDeSites.Core/BloqueurDeSites.Core.csproj']).toContain(
        '<TargetFramework>net10.0</TargetFramework>',
      );
      expect(byPath['tests/BloqueurDeSites.Tests/BloqueurDeSites.Tests.csproj']).toContain(
        'Include="xunit" Version="2.9.3"',
      );
      const all = files.map((f) => f.content).join('\n');
      expect(all).not.toMatch(/requireAdministrator|runas|drivers\\etc|Registry/);
      expect(
        scanDiff(
          files
            .map(
              (f) =>
                `diff --git a/${f.path} b/${f.path}\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${f.content.split('\n').length} @@\n${f.content
                  .split('\n')
                  .map((l) => `+${l}`)
                  .join('\n')}\n`,
            )
            .join(''),
        ),
      ).toEqual([]);
    },
  );

  it('applis Windows : se compilent aussi hors de Windows ; le gabarit exige la version du SDK', () => {
    const winforms = renderTemplate('dotnet-winforms', {
      packageName: 'bloqueur',
      title: 'Bloqueur',
      description: '',
      tfm: 'net8.0',
    });
    const app = winforms.find((f) => f.path.endsWith('.App.csproj'))!.content;
    expect(app).toContain('<TargetFramework>net8.0-windows</TargetFramework>');
    expect(app).toContain('<EnableWindowsTargeting>true</EnableWindowsTargeting>');
    expect(app).toContain('<UseWindowsForms>true</UseWindowsForms>');
    expect(() =>
      renderTemplate('dotnet-wpf', { packageName: 'x', title: 'X', description: '' }),
    ).toThrow(/SDK/);
    expect(templateToolchain('dotnet-worker')).toBe('dotnet');
    expect(templateToolchain('node-cli')).toBe('node');
    expect(factorySchema.parse({ template: 'WinForms', name: 'Bloqueur' }).template).toBe(
      'dotnet-winforms',
    );
  });
});
