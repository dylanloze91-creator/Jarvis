import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RepoFacts } from '@jarvis/core';
import type { Runner } from './runner.js';

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Relevé de la copie de travail : fichiers lus et git en lecture seule. */
export async function gatherRepoFacts(path: string, run: Runner): Promise<RepoFacts> {
  const facts: RepoFacts = { path, exists: false, isDirectory: false, hasGit: false };
  try {
    const info = await stat(path);
    facts.exists = true;
    facts.isDirectory = info.isDirectory();
  } catch {
    return facts;
  }
  if (!facts.isDirectory) return facts;
  facts.hasGit = existsSync(join(path, '.git'));
  facts.hasNodeModules = existsSync(join(path, 'node_modules'));
  const root = await readJson(join(path, 'package.json'));
  const desktop = await readJson(join(path, 'apps', 'desktop', 'package.json'));
  facts.rootPackageName = text(root?.name);
  facts.desktopPackageName = text(desktop?.name);
  facts.desktopVersion = text(desktop?.version);
  if (facts.hasGit) {
    const git = (args: string[]) => run({ program: 'git', args, cwd: path, timeoutMs: 15_000 });
    const [origin, branch, head, status] = await Promise.all([
      git(['remote', 'get-url', 'origin']),
      git(['rev-parse', '--abbrev-ref', 'HEAD']),
      git(['rev-parse', 'HEAD']),
      git(['status', '--porcelain']),
    ]);
    facts.originUrl = origin.code === 0 ? text(origin.stdout) : null;
    facts.branch = branch.code === 0 ? text(branch.stdout) : null;
    facts.head = head.code === 0 ? text(head.stdout) : null;
    facts.dirtyFiles =
      status.code === 0 ? status.stdout.split('\n').filter((line) => line.trim()).length : null;
  }
  return facts;
}

/** Première copie candidate qui ressemble à Jarvis (dépôt git + package « jarvis »). */
export async function detectRepo(candidates: string[], run: Runner): Promise<RepoFacts | null> {
  for (const candidate of candidates) {
    if (!existsSync(join(candidate, '.git'))) continue;
    const facts = await gatherRepoFacts(candidate, run);
    if (facts.rootPackageName === 'jarvis') return facts;
  }
  return null;
}
