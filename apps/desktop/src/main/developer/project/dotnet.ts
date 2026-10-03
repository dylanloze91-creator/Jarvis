import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DOTNET_ENV, dotnetTargetFramework, parseDotnetSdks } from '@jarvis/core';
import { devPlatform } from '../platform/index.js';
import type { Runner } from '../runner.js';

export interface DotnetSdk {
  /** Versions installées (`dotnet --list-sdks`), vide si dotnet est absent. */
  sdks: string[];
  /** `net10.0`… pour les gabarits, ou null. */
  tfm: string | null;
  /** Commande d'installation à lancer soi-même (Jarvis ne la lance jamais), ou null. */
  hint: string | null;
}

export async function detectDotnet(run: Runner, cwd: string): Promise<DotnetSdk> {
  const platform = devPlatform();
  const hint = platform.installHint('dotnet');
  try {
    const outcome = await run({
      program: platform.dotnetProgram,
      args: ['--list-sdks'],
      cwd,
      display: 'dotnet --list-sdks',
      env: { ...process.env, ...DOTNET_ENV },
      timeoutMs: 20_000,
    });
    const sdks = outcome.code === 0 ? parseDotnetSdks(outcome.stdout) : [];
    const tfm = dotnetTargetFramework(sdks);
    return { sdks, tfm, hint: tfm ? null : hint };
  } catch {
    return { sdks: [], tfm: null, hint };
  }
}

/** Solution ou projet à la racine : un seul `.sln`/`.slnx`, sinon un seul `.csproj`. */
export async function dotnetTarget(dir: string): Promise<string | null> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const solutions = names.filter((n) => /\.(sln|slnx)$/i.test(n));
  if (solutions.length === 1) return solutions[0]!;
  if (solutions.length > 1) return null;
  const projects = names.filter((n) => /\.csproj$/i.test(n));
  return projects.length === 1 ? projects[0]! : null;
}

/** Un projet de test (Microsoft.NET.Test.Sdk) dans le dépôt, à trois niveaux au plus. */
export async function hasDotnetTests(dir: string, depth = 3): Promise<boolean> {
  let entries: Array<{ name: string; dir: boolean }> = [];
  try {
    entries = (await readdir(dir, { withFileTypes: true })).map((e) => ({
      name: e.name,
      dir: e.isDirectory(),
    }));
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.dir) {
      if (depth > 0 && !/^(bin|obj|node_modules|\.git|\.vs)$/i.test(entry.name))
        if (await hasDotnetTests(join(dir, entry.name), depth - 1)) return true;
    } else if (/\.csproj$/i.test(entry.name)) {
      try {
        if ((await readFile(join(dir, entry.name), 'utf8')).includes('Microsoft.NET.Test.Sdk'))
          return true;
      } catch {
        // fichier illisible : ignoré
      }
    }
  }
  return false;
}
