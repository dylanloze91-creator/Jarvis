import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeSuites, validateNodeFacts, type DevCheck } from '@jarvis/core';
import { gatherRepoFacts } from '../repo.js';
import type { Runner } from '../runner.js';
import { detectDotnet, dotnetTarget, hasDotnetTests } from './dotnet.js';

export interface ProjectCheck {
  ok: boolean;
  checks: DevCheck[];
  /** `node` (package.json), `dotnet` (solution ou projet .NET à la racine), sinon null. */
  toolchain: 'node' | 'dotnet' | null;
  name: string | null;
  description: string;
  scripts: Record<string, string>;
  /** Solution ou projet .NET (0.5.4). */
  target: string | null;
  branch: string | null;
  head: string | null;
  dirtyFiles: number | null;
}

async function packageJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Un projet prêt pour une tâche : dépôt git avec un commit, puis pour Node
 * `package-lock.json` et un test, pour .NET une solution, le SDK et un projet de test.
 */
export async function inspectProject(path: string, run: Runner): Promise<ProjectCheck> {
  const facts = await gatherRepoFacts(path, run);
  const pkg = facts.isDirectory ? await packageJson(path) : null;
  const target = !pkg && facts.isDirectory ? await dotnetTarget(path) : null;
  const scripts: Record<string, string> = {};
  const raw = pkg?.scripts;
  if (raw && typeof raw === 'object')
    for (const [key, value] of Object.entries(raw as Record<string, unknown>))
      if (typeof value === 'string') scripts[key] = value;
  const report = validateNodeFacts(facts);
  const checks = target ? report.checks.filter((c) => c.id !== 'package') : [...report.checks];
  if (pkg) {
    const lock = existsSync(join(path, 'package-lock.json'));
    checks.push({
      id: 'lock',
      label: 'package-lock.json',
      status: lock ? 'ok' : 'fail',
      detail: lock
        ? 'présent (la copie isolée s’installe avec npm ci)'
        : 'absent : lance « npm install » une fois dans ce dossier, puis enregistre le fichier (commit).',
    });
    const suites = nodeSuites(scripts);
    checks.push({
      id: 'tests',
      label: 'Tests',
      status: suites.length ? 'ok' : 'fail',
      detail: suites.length
        ? suites.map((s) => (s === 'test' ? 'npm test' : `npm run ${s}`)).join(', ')
        : 'ni script « typecheck » ni script « test » dans package.json : Jarvis ne pourrait rien vérifier.',
    });
  } else if (target) {
    checks.push({ id: 'solution', label: 'Solution .NET', status: 'ok', detail: target });
    const sdk = await detectDotnet(run, path);
    checks.push({
      id: 'sdk',
      label: 'SDK .NET',
      status: sdk.sdks.length ? 'ok' : 'fail',
      detail: sdk.sdks.length
        ? sdk.sdks.join(', ')
        : `introuvable : installe le SDK .NET${sdk.hint ? ` (${sdk.hint})` : ''}.`,
      ...(sdk.hint && !sdk.sdks.length ? { command: sdk.hint } : {}),
    });
    const tests = await hasDotnetTests(path);
    checks.push({
      id: 'tests',
      label: 'Tests',
      status: tests ? 'ok' : 'warn',
      detail: tests
        ? 'projet de test trouvé (dotnet test)'
        : 'aucun projet de test : seule la compilation vérifiera le travail.',
    });
  } else if (facts.isDirectory) {
    const package_ = checks.find((c) => c.id === 'package');
    if (package_)
      package_.detail =
        'ni package.json ni solution .NET (.sln, .slnx ou .csproj unique) à la racine.';
  }
  if (facts.dirtyFiles)
    checks.push({
      id: 'dirty',
      label: 'Modifications',
      status: 'warn',
      detail: `${facts.dirtyFiles} fichier(s) modifié(s) non enregistré(s) : les tâches partent du dernier commit.`,
    });
  const name = pkg
    ? (facts.rootPackageName ?? null)
    : target
      ? target.replace(/\.[^.]+$/, '')
      : null;
  return {
    ok: checks.every((c) => c.status !== 'fail'),
    checks,
    toolchain: pkg ? 'node' : target ? 'dotnet' : null,
    name,
    description: typeof pkg?.description === 'string' ? pkg.description.slice(0, 400) : '',
    scripts,
    target,
    branch: facts.branch ?? null,
    head: facts.head ?? null,
    dirtyFiles: facts.dirtyFiles ?? null,
  };
}
