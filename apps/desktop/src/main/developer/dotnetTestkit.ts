import { execFileSync } from 'node:child_process';
import { dotnetTargetFramework, parseDotnetSdks } from '@jarvis/core';

/** Cible `net<N>.0` du SDK .NET installé sur la machine, ou null si `dotnet` est absent. */
export function installedDotnetTarget(): string | null {
  try {
    const out = execFileSync('dotnet', ['--list-sdks'], { encoding: 'utf8' });
    return dotnetTargetFramework(parseDotnetSdks(out));
  } catch {
    return null;
  }
}

/** Sortie simulée de `dotnet --list-sdks` pour le TFM donné (`net8.0` → `8.0.100`). */
export function fakeDotnetListSdks(tfm: string): string {
  const major = /^net(\d+)\.0$/.exec(tfm)?.[1] ?? '8';
  return `${major}.0.100 [/usr/lib/dotnet/sdk]\n`;
}

export function dotnetDesktopTfm(tfm: string): string {
  return `${tfm}-windows`;
}
