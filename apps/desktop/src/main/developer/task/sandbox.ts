import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { CommandSafetyContext } from '@jarvis/core';
import { GIT_SAFE } from '../tools/common.js';
import type { RunOutcome, Runner } from '../runner.js';

/** 1,1 Go de dépendances (mesuré, décision 3) plus une marge pour les tests et les caches. */
export const SANDBOX_MIN_FREE_BYTES = 3e9;
export const SANDBOX_BRANCH_PATTERN = /^jarvis-dev\/[A-Za-z0-9._-]+$/;

/** Les points de reprise sont signés « Jarvis Développeur », jamais avec l'identité de l'utilisateur. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Jarvis Développeur',
  GIT_AUTHOR_EMAIL: 'jarvis-dev@localhost',
  GIT_COMMITTER_NAME: 'Jarvis Développeur',
  GIT_COMMITTER_EMAIL: 'jarvis-dev@localhost',
  GIT_TERMINAL_PROMPT: '0',
};

export function defaultWorktreeRoot(repoPath: string): string {
  return join(dirname(repoPath), `${basename(repoPath)}-taches`);
}

function comparable(path: string): string {
  const value = resolve(path);
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

export function isInside(root: string, path: string): boolean {
  const base = comparable(root);
  const target = comparable(path);
  return target.startsWith(base.endsWith(sep) ? base : base + sep);
}

export function samePath(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

function failed(outcome: RunOutcome, what: string): SandboxError {
  const detail = (outcome.error ?? outcome.stderr.trim()) || outcome.stdout.trim();
  return new SandboxError(`${what} a échoué : ${detail.split('\n').slice(-4).join(' ')}`);
}

export interface Checkpoint {
  sha: string;
  label: string;
  at: number;
}

/** Une copie isolée : un worktree git sur une branche `jarvis-dev/*`, à côté de la copie de l'utilisateur. */
export class Sandbox {
  constructor(
    readonly path: string,
    readonly branch: string,
    readonly baseCommit: string,
    private readonly run: Runner,
  ) {
    if (!SANDBOX_BRANCH_PATTERN.test(branch))
      throw new SandboxError(`Branche refusée : ${branch} (seulement jarvis-dev/*).`);
  }

  async context(): Promise<CommandSafetyContext> {
    let packageScripts: Record<string, string> | undefined;
    try {
      const pkg = JSON.parse(await readFile(join(this.path, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      packageScripts = pkg.scripts;
    } catch {
      packageScripts = undefined;
    }
    return { insideSandbox: true, branch: this.branch, packageScripts };
  }

  async git(args: string[], display: string, signal?: AbortSignal): Promise<RunOutcome> {
    return this.run({
      program: 'git',
      args: [...GIT_SAFE, ...args],
      cwd: this.path,
      display,
      env: { ...process.env, ...IDENTITY },
      timeoutMs: 120_000,
      maxBytes: 4_000_000,
      context: { insideSandbox: true, branch: this.branch },
      signal,
    });
  }

  /** Point de reprise = commit sur la branche de la tâche. Null s'il n'y a rien à enregistrer. */
  async checkpoint(label: string, signal?: AbortSignal): Promise<Checkpoint | null> {
    const add = await this.git(['add', '-A'], 'git add -A', signal);
    if (add.code !== 0) throw failed(add, 'git add');
    const staged = await this.git(
      ['diff', '--cached', '--quiet'],
      'git diff --cached --quiet',
      signal,
    );
    if (staged.code === 0) return null;
    const message = `Jarvis Développeur : ${label}`.replace(/"/g, "'").slice(0, 120);
    const commit = await this.git(
      ['commit', '--no-verify', '--no-gpg-sign', '-m', message],
      `git commit --no-verify --no-gpg-sign -m "${message}"`,
      signal,
    );
    if (commit.code !== 0) throw failed(commit, 'git commit');
    const head = await this.head(signal);
    return { sha: head, label, at: Date.now() };
  }

  async head(signal?: AbortSignal): Promise<string> {
    const outcome = await this.git(['rev-parse', 'HEAD'], 'git rev-parse HEAD', signal);
    if (outcome.code !== 0) throw failed(outcome, 'git rev-parse');
    return outcome.stdout.trim();
  }

  /** Diff complet depuis le départ de la tâche (fichiers nouveaux compris). */
  async diff(signal?: AbortSignal): Promise<string> {
    const add = await this.git(['add', '-A'], 'git add -A', signal);
    if (add.code !== 0) throw failed(add, 'git add');
    const outcome = await this.git(
      ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '-M', this.baseCommit],
      'git diff --cached',
      signal,
    );
    if (outcome.code !== 0) throw failed(outcome, 'git diff');
    return outcome.stdout;
  }

  rollbackCommands(target: string): string[] {
    return [`git reset --hard ${target.slice(0, 12)}`, 'git clean -fd'];
  }

  /** Retour à un point de reprise. Toujours confirmé avant (décision 9). */
  async rollback(target: string, signal?: AbortSignal): Promise<void> {
    if (!/^[0-9a-f]{7,40}$/i.test(target))
      throw new SandboxError(`Point de reprise invalide : ${target}`);
    const reset = await this.git(
      ['reset', '--hard', target],
      `git reset --hard ${target.slice(0, 12)}`,
      signal,
    );
    if (reset.code !== 0) throw failed(reset, 'git reset');
    const clean = await this.git(['clean', '-fd'], 'git clean -fd', signal);
    if (clean.code !== 0) throw failed(clean, 'git clean');
  }

  discardCommands(): string[] {
    return discardCommands(this.path, this.branch);
  }

  async discard(signal?: AbortSignal): Promise<void> {
    await discardWorktree(this.run, this.path, this.branch, signal);
  }
}

export function discardCommands(path: string, branch: string): string[] {
  return [
    'git reset --hard',
    'git clean -fd',
    'git checkout --detach',
    `git branch -D ${branch}`,
    `git worktree remove "${path}"`,
  ];
}

/**
 * Jeter une copie isolée, depuis l'intérieur : la branche jarvis-dev/* puis le
 * dossier (node_modules ignoré compris). Rien ne touche la copie de l'utilisateur.
 */
export async function discardWorktree(
  run: Runner,
  path: string,
  branch: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!SANDBOX_BRANCH_PATTERN.test(branch))
    throw new SandboxError(`Branche refusée : ${branch} (seulement jarvis-dev/*).`);
  const git = (args: string[], display: string, ctxBranch: string | null) =>
    run({
      program: 'git',
      args: [...GIT_SAFE, ...args],
      cwd: path,
      display,
      env: { ...process.env, ...IDENTITY },
      timeoutMs: 300_000,
      context: { insideSandbox: true, branch: ctxBranch },
      signal,
    });
  const steps: Array<[string[], string, string | null]> = [
    [['reset', '--hard'], 'git reset --hard', branch],
    [['clean', '-fd'], 'git clean -fd', branch],
    [['checkout', '--detach'], 'git checkout --detach', branch],
    [['branch', '-D', branch], `git branch -D ${branch}`, null],
    [['worktree', 'remove', path], `git worktree remove "${path}"`, null],
  ];
  for (const [args, display, ctxBranch] of steps) {
    const outcome = await git(args, display, ctxBranch);
    if (outcome.code !== 0) throw failed(outcome, display);
  }
}

export interface SandboxDeps {
  run: Runner;
  repoRoot: string;
  root: string;
  freeBytes(path: string): Promise<number | null>;
  signal?: AbortSignal;
}

/** Crée le worktree `jarvis-dev/*` à partir du dernier commit de la copie de l'utilisateur. */
export async function createSandbox(
  deps: SandboxDeps,
  branch: string,
  folder: string,
): Promise<Sandbox> {
  if (!SANDBOX_BRANCH_PATTERN.test(branch))
    throw new SandboxError(`Branche refusée : ${branch} (seulement jarvis-dev/*).`);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(folder)) throw new SandboxError(`Dossier refusé : ${folder}`);
  const path = join(deps.root, folder);
  if (!isInside(deps.root, path) || isInside(deps.repoRoot, path) || samePath(path, deps.repoRoot))
    throw new SandboxError('La copie isolée doit être hors de ta copie de travail.');
  if (existsSync(path)) throw new SandboxError(`« ${path} » existe déjà.`);
  await mkdir(deps.root, { recursive: true });
  const free = await deps.freeBytes(deps.root);
  if (free !== null && free < SANDBOX_MIN_FREE_BYTES)
    throw new SandboxError(
      `Pas assez de place : ${(free / 1e9).toFixed(1)} Go libres dans ${deps.root}, il en faut ${SANDBOX_MIN_FREE_BYTES / 1e9} (dépendances comprises). Jette d’anciennes tâches.`,
    );
  const repoGit = (args: string[], display: string) =>
    deps.run({
      program: 'git',
      args: [...GIT_SAFE, ...args],
      cwd: deps.repoRoot,
      display,
      timeoutMs: 120_000,
      signal: deps.signal,
    });
  const head = await repoGit(['rev-parse', 'HEAD'], 'git rev-parse HEAD');
  if (head.code !== 0) throw failed(head, 'git rev-parse');
  const base = head.stdout.trim();
  const add = await repoGit(
    ['worktree', 'add', '-b', branch, path, base],
    `git worktree add -b ${branch} "${path}" ${base.slice(0, 12)}`,
  );
  if (add.code !== 0) throw failed(add, 'git worktree add');
  return new Sandbox(path, branch, base, deps.run);
}

export interface SandboxSummary {
  path: string;
  branch: string;
  head: string | null;
  modifiedAt: number | null;
  /** Dossier disparu : `git worktree prune` suffit. */
  missing: boolean;
}

/** Copies isolées jarvis-dev/* connues de git, sous le dossier des tâches. */
export async function listSandboxes(
  run: Runner,
  repoRoot: string,
  root: string,
): Promise<SandboxSummary[]> {
  const outcome = await run({
    program: 'git',
    args: [...GIT_SAFE, 'worktree', 'list', '--porcelain'],
    cwd: repoRoot,
    display: 'git worktree list --porcelain',
    timeoutMs: 20_000,
  });
  if (outcome.code !== 0) throw failed(outcome, 'git worktree list');
  const out: SandboxSummary[] = [];
  for (const block of outcome.stdout.split(/\n\s*\n/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]?.trim();
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]?.trim();
    if (!path || !branch || !SANDBOX_BRANCH_PATTERN.test(branch) || !isInside(root, path)) continue;
    const head = /^HEAD ([0-9a-f]+)$/m.exec(block)?.[1] ?? null;
    let modifiedAt: number | null = null;
    try {
      modifiedAt = (await stat(path)).mtimeMs;
    } catch {
      modifiedAt = null;
    }
    out.push({ path: resolve(path), branch, head, modifiedAt, missing: modifiedAt === null });
  }
  return out;
}

export async function pruneWorktrees(run: Runner, repoRoot: string): Promise<void> {
  const outcome = await run({
    program: 'git',
    args: [...GIT_SAFE, 'worktree', 'prune'],
    cwd: repoRoot,
    display: 'git worktree prune',
    timeoutMs: 60_000,
  });
  if (outcome.code !== 0) throw failed(outcome, 'git worktree prune');
}
