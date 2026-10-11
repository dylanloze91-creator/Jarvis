import { describe, expect, it } from 'vitest';
import { steerFactory } from './fallbacks.js';
import {
  DESKTOP_WINDOWS_EXE,
  dotnetPublishWinExeCommand,
  dotnetWinExeArtifactRelative,
  dotnetDesktopTemplateReferences,
  requestsWindowsDesktopExe,
} from './dotnetDesktop.js';
import { templatePlan } from './fallbacks.js';

describe('dotnetDesktop', () => {
  it('publie un .exe Windows avec un chemin prévisible', () => {
    expect(dotnetPublishWinExeCommand('Compteur de clics')).toBe(
      'dotnet publish src/CompteurDeClics.App/CompteurDeClics.App.csproj -c Release -r win-x64 --no-self-contained',
    );
    expect(dotnetWinExeArtifactRelative('Compteur de clics')).toBe(
      'src/CompteurDeClics.App/bin/Release/net10.0-windows/win-x64/publish/CompteurDeClics.App.exe',
    );
  });

  it('références et plan de secours WinForms', () => {
    expect(dotnetDesktopTemplateReferences('dotnet-winforms', 'Compteur')).toEqual([
      'src/Compteur.App/MainForm.cs',
      'src/Compteur.Core/Salutation.cs',
      'tests/Compteur.Tests/SalutationTests.cs',
    ]);
    const plan = templatePlan('dotnet-winforms', 'Compteur');
    expect(plan?.tests).toEqual(['typecheck', 'test']);
    expect(plan?.files.map((f) => f.path)).toContain('src/Compteur.Core/Salutation.cs');
  });

  it('formulations françaises sans mot « .exe »', () => {
    const plain = [
      'Fais-moi une appli Windows',
      'fais-moi une appli Windows avec un compteur',
      'Un programme sur le bureau pour compter les jours',
      'Crée une appli sur le bureau : notes simples',
    ];
    for (const phrase of plain) {
      expect(requestsWindowsDesktopExe(phrase), phrase).toBe(true);
      expect(DESKTOP_WINDOWS_EXE.test(phrase), phrase).toBe(true);
    }
    expect(requestsWindowsDesktopExe('Une page web React')).toBe(false);
    expect(requestsWindowsDesktopExe('Un programme en ligne de commande')).toBe(false);
  });

  it('une demande .exe ne part pas du gabarit web', () => {
    const react = { template: 'vite-react' as const, name: 'Compteur', description: '' };
    expect(
      steerFactory('Crée une appli de bureau Windows avec un .exe compteur', react).template,
    ).toBe('dotnet-winforms');
  });
});
