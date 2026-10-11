import { DOTNET_TEMPLATE_IDS, dotnetIdentifier } from './dotnetTemplates.js';
import type { ProjectTemplateId } from './templates.js';

/** Demande explicite d’un programme Windows packagé (.exe), pas d’une page web. */
export const DESKTOP_WINDOWS_EXE =
  /(?:\.exe\b|exécutable|executable|application de bureau|appli de bureau|programme windows|bureau windows|winforms|wpf|fenêtre windows|application windows|appli windows)/i;

export function isDotnetWindowsDesktopTemplate(
  template: ProjectTemplateId | null | undefined,
): boolean {
  return template === 'dotnet-winforms' || template === 'dotnet-wpf';
}

/** Nom C# du projet (`BloqueurDeSites`) à partir du titre affiché. */
export function dotnetProjectBaseName(projectTitle: string): string {
  return dotnetIdentifier(projectTitle);
}

/** Nom de la solution à la racine (`BloqueurDeSites.sln`). */
export function dotnetSolutionFile(projectTitle: string): string {
  return `${dotnetProjectBaseName(projectTitle)}.sln`;
}

/** Chemin relatif du .exe après `dotnet publish` (RID win-x64, hors Windows). */
export function dotnetWinExeArtifactRelative(
  projectTitle: string,
  tfmWindows = 'net10.0-windows',
): string {
  const n = dotnetProjectBaseName(projectTitle);
  return `src/${n}.App/bin/Release/${tfmWindows}/win-x64/publish/${n}.App.exe`;
}

/** Commande affichée dans l’UI « Construire » et pour les preuves. */
export function dotnetPublishWinExeCommand(projectTitle: string): string {
  const n = dotnetProjectBaseName(projectTitle);
  return `dotnet publish src/${n}.App/${n}.App.csproj -c Release -r win-x64 --no-self-contained`;
}

/** Fichiers de référence pour l’écriture fichier par fichier (missions .NET bureau). */
export function dotnetDesktopTemplateReferences(
  template: ProjectTemplateId,
  projectTitle: string,
): readonly string[] {
  if (!isDotnetWindowsDesktopTemplate(template)) return [];
  const n = dotnetProjectBaseName(projectTitle);
  const ui =
    template === 'dotnet-wpf'
      ? [`src/${n}.App/MainWindow.xaml.cs`, `src/${n}.App/MainWindow.xaml`]
      : [`src/${n}.App/MainForm.cs`];
  return [...ui, `src/${n}.Core/Salutation.cs`, `tests/${n}.Tests/SalutationTests.cs`];
}

export function dotnetTemplateEntryFiles(
  template: ProjectTemplateId,
  projectTitle: string,
): Array<[string, string]> | null {
  if (!(DOTNET_TEMPLATE_IDS as readonly string[]).includes(template)) return null;
  const n = dotnetProjectBaseName(projectTitle);
  const files: Array<[string, string]> = [
    [`src/${n}.Core/Salutation.cs`, 'logique testée (xUnit)'],
    [`tests/${n}.Tests/SalutationTests.cs`, 'tests de la logique'],
  ];
  if (template === 'dotnet-winforms')
    files.push([`src/${n}.App/MainForm.cs`, 'interface WinForms (mince)']);
  if (template === 'dotnet-wpf')
    files.push([`src/${n}.App/MainWindow.xaml.cs`, 'interface WPF (mince)']);
  return files;
}
