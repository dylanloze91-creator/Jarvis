import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { checkEnvironment, type CheckReport, type EnvironmentFacts } from '@jarvis/core';
import type { Runner } from './runner.js';

export interface EnvironmentProbe {
  facts: EnvironmentFacts;
  report: CheckReport;
  /** Node de l'utilisateur (pas celui d'Electron), pour lancer npm sans shell. */
  nodePath: string | null;
  npmCli: string | null;
}

export interface ProbeDeps {
  run: Runner;
  platform: NodeJS.Platform;
  /** Dossier dont on mesure le disque (copie de travail ou son parent). */
  diskPath: string;
  cwd: string;
  freeBytes?: (path: string) => Promise<number | null>;
}

export async function measureFree(path: string): Promise<number | null> {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try {
    const stats = await statfs(current);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

/** npm-cli.js à côté du node.exe de l'utilisateur : npm.cmd ne se lance pas sans shell (Node ≥ 18.20.2). */
export function npmCliCandidates(nodePath: string, platform: NodeJS.Platform): string[] {
  const dir = dirname(nodePath);
  return platform === 'win32'
    ? [join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : [
        join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ];
}

export async function probeEnvironment(deps: ProbeDeps): Promise<EnvironmentProbe> {
  const base = { cwd: deps.cwd, timeoutMs: 15_000 };
  const ok = (outcome: { code: number | null; error: string | null }) =>
    outcome.code === 0 && !outcome.error;

  const git = await deps.run({ ...base, program: 'git', args: ['--version'] });
  const node = await deps.run({
    ...base,
    program: 'node',
    args: ['-p', "process.execPath + '|' + process.version"],
    display: 'node --version',
  });
  let nodePath: string | null = null;
  let nodeVersion: string | null = null;
  if (ok(node)) {
    const [path, version] = node.stdout.trim().split('|');
    nodePath = path || null;
    nodeVersion = version || null;
  }
  let npmCli: string | null = null;
  let npmVersion: string | null = null;
  if (nodePath) {
    npmCli =
      npmCliCandidates(nodePath, deps.platform).find((candidate) => existsSync(candidate)) ?? null;
    if (npmCli) {
      const npm = await deps.run({
        ...base,
        program: nodePath,
        args: [npmCli, '--version'],
        display: 'npm --version',
      });
      if (ok(npm)) npmVersion = npm.stdout.trim();
    }
  }
  let longPaths: boolean | null = null;
  if (ok(git) && deps.platform === 'win32') {
    const config = await deps.run({
      ...base,
      program: 'git',
      args: ['config', '--global', '--get', 'core.longpaths'],
    });
    longPaths = config.stdout.trim().toLowerCase() === 'true';
  }
  const freeBytes = await (deps.freeBytes ?? measureFree)(deps.diskPath);
  const facts: EnvironmentFacts = {
    platform: deps.platform,
    gitVersion: ok(git) ? git.stdout.trim() : null,
    nodeVersion,
    npmVersion,
    freeBytes,
    diskPath: parse(deps.diskPath).root || deps.diskPath,
    longPaths,
  };
  return { facts, report: checkEnvironment(facts), nodePath, npmCli };
}
