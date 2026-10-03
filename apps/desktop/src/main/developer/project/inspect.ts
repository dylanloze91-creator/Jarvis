import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeSuites, validateNodeFacts, type DevCheck } from '@jarvis/core';
import { gatherRepoFacts } from '../repo.js';
import type { Runner } from '../runner.js';

export interface ProjectCheck {
  ok: boolean;
  checks: DevCheck[];
  name: string | null;
  description: string;
  scripts: Record<string, string>;
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

/** Un projet Node prêt pour une tâche : dépôt git avec un commit, package-lock.json, un test. */
export async function inspectProject(path: string, run: Runner): Promise<ProjectCheck> {
  const facts = await gatherRepoFacts(path, run);
  const report = validateNodeFacts(facts);
  const pkg = facts.isDirectory ? await packageJson(path) : null;
  const scripts: Record<string, string> = {};
  const raw = pkg?.scripts;
  if (raw && typeof raw === 'object')
    for (const [key, value] of Object.entries(raw as Record<string, unknown>))
      if (typeof value === 'string') scripts[key] = value;
  const checks = [...report.checks];
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
  }
  if (facts.dirtyFiles)
    checks.push({
      id: 'dirty',
      label: 'Modifications',
      status: 'warn',
      detail: `${facts.dirtyFiles} fichier(s) modifié(s) non enregistré(s) : les tâches partent du dernier commit.`,
    });
  return {
    ok: checks.every((c) => c.status !== 'fail'),
    checks,
    name: facts.rootPackageName ?? null,
    description: typeof pkg?.description === 'string' ? pkg.description.slice(0, 400) : '',
    scripts,
    branch: facts.branch ?? null,
    head: facts.head ?? null,
    dirtyFiles: facts.dirtyFiles ?? null,
  };
}
