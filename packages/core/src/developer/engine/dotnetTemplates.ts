import type { TemplateFile } from './templates.js';

/**
 * Gabarits .NET de la Project Factory (0.5.4) : une bibliothèque `Core`
 * testée (xUnit), une application mince qui l'appelle, et une solution.
 * Les applications Windows (WinForms, WPF) se compilent aussi hors de
 * Windows (`EnableWindowsTargeting`) ; leurs tests portent sur `Core`.
 * Versions des paquets de test : celles du modèle xUnit du SDK .NET 10.
 */
export const DOTNET_TEMPLATE_IDS = [
  'dotnet-winforms',
  'dotnet-wpf',
  'dotnet-console',
  'dotnet-worker',
] as const;
export type DotnetTemplateId = (typeof DOTNET_TEMPLATE_IDS)[number];

export const DOTNET_TEMPLATES: Record<DotnetTemplateId, { label: string; description: string }> = {
  'dotnet-winforms': {
    label: 'Application Windows (WinForms, .NET)',
    description: 'une fenêtre Windows simple, avec sa logique testée à part',
  },
  'dotnet-wpf': {
    label: 'Application Windows (WPF, .NET)',
    description: 'une fenêtre Windows en XAML, avec sa logique testée à part',
  },
  'dotnet-console': {
    label: 'Programme console (.NET)',
    description: 'un programme lancé dans un terminal, avec sa logique testée à part',
  },
  'dotnet-worker': {
    label: 'Service en arrière-plan (.NET Worker)',
    description: 'une tâche qui tourne en fond, avec sa logique testée à part',
  },
};

export const DOTNET_TEST_PACKAGES = {
  'Microsoft.NET.Test.Sdk': '17.14.1',
  xunit: '2.9.3',
  'xunit.runner.visualstudio': '3.1.4',
} as const;

const FROM = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ';
const TO = 'aaaaaaceeeeiiiinooooouuuuyyoa';

/** Nom C# valide tiré du titre : « Bloqueur de sites » → « BloqueurDeSites ». */
export function dotnetIdentifier(title: string): string {
  const ascii = [...title]
    .map((c) => {
      const i = FROM.indexOf(c.toLowerCase());
      return i >= 0 ? (c === c.toLowerCase() ? TO[i]! : TO[i]!.toUpperCase()) : c;
    })
    .join('');
  const name = ascii
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('')
    .slice(0, 40);
  return /^[A-Za-z]/.test(name) ? name : `Projet${name}`;
}

function fnv(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** GUID stable (même nom = même GUID), pour une solution reproductible. */
export function stableGuid(seed: string): string {
  const hex = [0, 1, 2, 3]
    .map((i) => fnv(`${i}:${seed}`))
    .join('')
    .toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const CSHARP = 'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC';

/** Solution au format classique (`.sln`), lue par tous les SDK depuis .NET 8. */
export function solutionFile(projects: Array<{ name: string; path: string }>): string {
  const ids = projects.map((p) => ({ ...p, guid: stableGuid(p.path) }));
  const lines = [
    '',
    'Microsoft Visual Studio Solution File, Format Version 12.00',
    '# Visual Studio Version 17',
    'VisualStudioVersion = 17.0.31903.59',
    'MinimumVisualStudioVersion = 10.0.40219.1',
    ...ids.flatMap((p) => [
      `Project("{${CSHARP}}") = "${p.name}", "${p.path.replace(/\//g, '\\')}", "{${p.guid}}"`,
      'EndProject',
    ]),
    'Global',
    '\tGlobalSection(SolutionConfigurationPlatforms) = preSolution',
    '\t\tDebug|Any CPU = Debug|Any CPU',
    '\t\tRelease|Any CPU = Release|Any CPU',
    '\tEndGlobalSection',
    '\tGlobalSection(ProjectConfigurationPlatforms) = postSolution',
    ...ids.flatMap((p) => [
      `\t\t{${p.guid}}.Debug|Any CPU.ActiveCfg = Debug|Any CPU`,
      `\t\t{${p.guid}}.Debug|Any CPU.Build.0 = Debug|Any CPU`,
      `\t\t{${p.guid}}.Release|Any CPU.ActiveCfg = Release|Any CPU`,
      `\t\t{${p.guid}}.Release|Any CPU.Build.0 = Release|Any CPU`,
    ]),
    '\tEndGlobalSection',
    'EndGlobal',
    '',
  ];
  return lines.join('\r\n');
}

export interface DotnetTemplateInput {
  /** Nom C# (`dotnetIdentifier`). */
  name: string;
  title: string;
  description: string;
  /** `net10.0`… (`dotnetTargetFramework`). */
  tfm: string;
}

function csproj(
  properties: Record<string, string>,
  items: string[] = [],
  sdk = 'Microsoft.NET.Sdk',
): string {
  const props = Object.entries(properties)
    .map(([k, v]) => `    <${k}>${v}</${k}>`)
    .join('\n');
  const groups = items.map((item) => `\n  <ItemGroup>\n${item}\n  </ItemGroup>\n`).join('');
  return `<Project Sdk="${sdk}">\n\n  <PropertyGroup>\n${props}\n  </PropertyGroup>\n${groups}\n</Project>\n`;
}

function xml(text: string): string {
  return text.replace(/[<>&"]/g, '');
}

function csString(text: string): string {
  return text.replace(/[\\"{}]/g, '').replace(/\s+/g, ' ');
}

const GITIGNORE = 'bin/\nobj/\n.vs/\n*.user\n*.suo\nTestResults/\n';

function appFiles(id: DotnetTemplateId, input: DotnetTemplateInput): TemplateFile[] {
  const { name: n, tfm } = input;
  const dir = `src/${n}.App`;
  const core = `    <ProjectReference Include="..\\${n}.Core\\${n}.Core.csproj" />`;
  const windows = { TargetFramework: `${tfm}-windows`, EnableWindowsTargeting: 'true' };
  const common = { ImplicitUsings: 'enable', Nullable: 'enable', RootNamespace: `${n}.App` };
  const title = csString(input.title);
  if (id === 'dotnet-winforms')
    return [
      {
        path: `${dir}/${n}.App.csproj`,
        content: csproj({ OutputType: 'WinExe', ...windows, UseWindowsForms: 'true', ...common }, [
          core,
        ]),
      },
      {
        path: `${dir}/Program.cs`,
        content: `namespace ${n}.App;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
`,
      },
      {
        path: `${dir}/MainForm.cs`,
        content: `using ${n}.Core;

namespace ${n}.App;

/// <summary>Fenêtre principale : l'interface reste mince, la logique est dans ${n}.Core.</summary>
public sealed class MainForm : Form
{
    private readonly TextBox prenom = new() { PlaceholderText = "Ton prénom", Width = 240 };
    private readonly Label message = new() { AutoSize = true };

    public MainForm()
    {
        Text = "${title}";
        Width = 440;
        Height = 220;
        var bouton = new Button { Text = "Saluer", AutoSize = true };
        bouton.Click += (_, _) => message.Text = Salutation.Bonjour(prenom.Text);
        var panneau = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            FlowDirection = FlowDirection.TopDown,
        };
        panneau.Controls.AddRange(new Control[] { prenom, bouton, message });
        Controls.Add(panneau);
    }
}
`,
      },
    ];
  if (id === 'dotnet-wpf')
    return [
      {
        path: `${dir}/${n}.App.csproj`,
        content: csproj({ OutputType: 'WinExe', ...windows, UseWPF: 'true', ...common }, [core]),
      },
      {
        path: `${dir}/App.xaml`,
        content: `<Application x:Class="${n}.App.App"
             xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
             StartupUri="MainWindow.xaml">
</Application>
`,
      },
      {
        path: `${dir}/App.xaml.cs`,
        content: `namespace ${n}.App;

public partial class App : System.Windows.Application
{
}
`,
      },
      {
        path: `${dir}/MainWindow.xaml`,
        content: `<Window x:Class="${n}.App.MainWindow"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="${xml(input.title)}" Width="440" Height="220">
    <StackPanel Margin="16">
        <TextBox x:Name="Prenom" Width="240" HorizontalAlignment="Left" />
        <Button Content="Saluer" Click="Saluer" Margin="0,8,0,8" HorizontalAlignment="Left" />
        <TextBlock x:Name="Message" />
    </StackPanel>
</Window>
`,
      },
      {
        path: `${dir}/MainWindow.xaml.cs`,
        content: `using System.Windows;
using ${n}.Core;

namespace ${n}.App;

/// <summary>Fenêtre principale : l'interface reste mince, la logique est dans ${n}.Core.</summary>
public partial class MainWindow : Window
{
    public MainWindow() => InitializeComponent();

    private void Saluer(object sender, RoutedEventArgs e) => Message.Text = Salutation.Bonjour(Prenom.Text);
}
`,
      },
    ];
  if (id === 'dotnet-console')
    return [
      {
        path: `${dir}/${n}.App.csproj`,
        content: csproj({ OutputType: 'Exe', TargetFramework: tfm, ...common }, [core]),
      },
      {
        path: `${dir}/Program.cs`,
        content: `using ${n}.Core;

Console.WriteLine(Salutation.Bonjour(args.Length > 0 ? args[0] : null));
`,
      },
    ];
  const hosting = `${tfm.replace(/^net(\d+)\..*$/, '$1')}.0.*`;
  return [
    {
      path: `${dir}/${n}.App.csproj`,
      content: csproj(
        { TargetFramework: tfm, ...common },
        [
          `    <PackageReference Include="Microsoft.Extensions.Hosting" Version="${hosting}" />`,
          core,
        ],
        'Microsoft.NET.Sdk.Worker',
      ),
    },
    {
      path: `${dir}/Program.cs`,
      content: `using ${n}.App;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<Worker>();
builder.Build().Run();
`,
    },
    {
      path: `${dir}/Worker.cs`,
      content: `using ${n}.Core;

namespace ${n}.App;

/// <summary>Tâche de fond : la logique est dans ${n}.Core.</summary>
public sealed class Worker(ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            logger.LogInformation("{Message}", Salutation.Bonjour("service"));
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}
`,
    },
    {
      path: `${dir}/appsettings.json`,
      content: `{\n  "Logging": {\n    "LogLevel": {\n      "Default": "Information",\n      "Microsoft.Hosting.Lifetime": "Information"\n    }\n  }\n}\n`,
    },
  ];
}

export function renderDotnetTemplate(
  id: DotnetTemplateId,
  input: DotnetTemplateInput,
): TemplateFile[] {
  const { name: n, tfm } = input;
  const label = DOTNET_TEMPLATES[id];
  const run =
    id === 'dotnet-winforms' || id === 'dotnet-wpf'
      ? `dotnet run --project src/${n}.App (sous Windows)`
      : `dotnet run --project src/${n}.App`;
  const tests = Object.entries(DOTNET_TEST_PACKAGES)
    .map(([pkg, version]) => `    <PackageReference Include="${pkg}" Version="${version}" />`)
    .join('\n');
  return [
    {
      path: `${n}.sln`,
      content: solutionFile([
        { name: `${n}.Core`, path: `src/${n}.Core/${n}.Core.csproj` },
        { name: `${n}.App`, path: `src/${n}.App/${n}.App.csproj` },
        { name: `${n}.Tests`, path: `tests/${n}.Tests/${n}.Tests.csproj` },
      ]),
    },
    {
      path: `src/${n}.Core/${n}.Core.csproj`,
      content: csproj({ TargetFramework: tfm, ImplicitUsings: 'enable', Nullable: 'enable' }),
    },
    {
      path: `src/${n}.Core/Salutation.cs`,
      content: `namespace ${n}.Core;

/// <summary>Logique de l'application, testée dans tests/${n}.Tests.</summary>
public static class Salutation
{
    public static string Bonjour(string? prenom) =>
        string.IsNullOrWhiteSpace(prenom) ? "Bonjour !" : $"Bonjour, {prenom.Trim()} !";
}
`,
    },
    ...appFiles(id, input),
    {
      path: `tests/${n}.Tests/${n}.Tests.csproj`,
      content: csproj(
        { TargetFramework: tfm, ImplicitUsings: 'enable', Nullable: 'enable', IsPackable: 'false' },
        [
          tests,
          '    <Using Include="Xunit" />',
          `    <ProjectReference Include="..\\..\\src\\${n}.Core\\${n}.Core.csproj" />`,
        ],
      ),
    },
    {
      path: `tests/${n}.Tests/SalutationTests.cs`,
      content: `using ${n}.Core;

namespace ${n}.Tests;

public class SalutationTests
{
    [Fact]
    public void SalueParLePrenom() => Assert.Equal("Bonjour, Dylan !", Salutation.Bonjour(" Dylan "));

    [Fact]
    public void SalueSansPrenom() => Assert.Equal("Bonjour !", Salutation.Bonjour(""));
}
`,
    },
    {
      path: 'README.md',
      content: `# ${input.title}

${input.description || label.description}.

## Commandes

- \`dotnet restore ${n}.sln\`
- \`dotnet test ${n}.sln\`
- \`${run}\`

La logique est dans \`src/${n}.Core\` (testée dans \`tests/${n}.Tests\`), l'application dans \`src/${n}.App\`.

Créé par Jarvis Développeur à partir du gabarit « ${label.label} ».
`,
    },
    { path: '.gitignore', content: GITIGNORE },
  ];
}
