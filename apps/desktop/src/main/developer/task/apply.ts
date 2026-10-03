import { GIT_SAFE } from '../tools/common.js';
import type { RunOutcome, Runner } from '../runner.js';
import { JARVIS_GIT_IDENTITY } from './sandbox.js';

export class ApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyError';
  }
}

function git(run: Runner, root: string, args: string[], display: string, signal?: AbortSignal) {
  return run({
    program: 'git',
    args: [...GIT_SAFE, ...args],
    cwd: root,
    display,
    env: { ...process.env, ...JARVIS_GIT_IDENTITY },
    timeoutMs: 120_000,
    maxBytes: 400_000,
    signal,
  });
}

function detail(outcome: RunOutcome): string {
  return ((outcome.error ?? outcome.stderr.trim()) || outcome.stdout.trim())
    .split('\n')
    .slice(-6)
    .join(' ');
}

export interface ApplyTarget {
  /** Branche de la copie de l'utilisateur qui reçoit la fusion. */
  branch: string;
  head: string;
  /** Commits de la tâche absents de cette branche. */
  ahead: number;
}

/** Avant la carte : copie propre, sur une branche, qui contient encore le départ de la tâche. */
export async function checkApply(
  run: Runner,
  root: string,
  taskBranch: string,
  baseCommit: string,
): Promise<ApplyTarget> {
  const status = await git(run, root, ['status', '--porcelain=v1'], 'git status --porcelain=v1');
  if (status.code !== 0) throw new ApplyError(`git status a échoué : ${detail(status)}`);
  const changed = status.stdout.split('\n').filter((line) => line.trim() && !line.startsWith('??'));
  if (changed.length)
    throw new ApplyError(
      `Ta copie a ${changed.length} fichier(s) modifié(s) non enregistré(s) : enregistre-les (commit) ou mets-les de côté, puis réessaie. Rien n’a changé.`,
    );
  const branch = await git(
    run,
    root,
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    'git rev-parse --abbrev-ref HEAD',
  );
  if (branch.code !== 0 || !branch.stdout.trim() || branch.stdout.trim() === 'HEAD')
    throw new ApplyError('Ta copie n’est sur aucune branche (HEAD détachée) : rien n’a changé.');
  const head = await git(run, root, ['rev-parse', 'HEAD'], 'git rev-parse HEAD');
  if (head.code !== 0) throw new ApplyError(`git rev-parse a échoué : ${detail(head)}`);
  const ancestor = await git(
    run,
    root,
    ['merge-base', '--is-ancestor', baseCommit, 'HEAD'],
    `git merge-base --is-ancestor ${baseCommit.slice(0, 12)} HEAD`,
  );
  if (ancestor.code !== 0)
    throw new ApplyError(
      `Ta copie ne contient plus le commit de départ de la tâche (${baseCommit.slice(0, 7)}) : rien n’a changé.`,
    );
  const ahead = await git(
    run,
    root,
    ['rev-list', '--count', `HEAD..${taskBranch}`],
    `git rev-list --count HEAD..${taskBranch}`,
  );
  const count = Number.parseInt(ahead.stdout.trim(), 10) || 0;
  if (ahead.code !== 0 || count === 0)
    throw new ApplyError('Rien à appliquer : la branche de la tâche est déjà dans ta copie.');
  return { branch: branch.stdout.trim(), head: head.stdout.trim(), ahead: count };
}

export function mergeMessage(request: string, taskBranch: string): string {
  const subject = request.trim().replace(/\s+/g, ' ').replace(/"/g, "'").slice(0, 80);
  return `Jarvis Développeur : ${subject} (${taskBranch})`;
}

export function applyCommands(taskBranch: string, message: string): string[] {
  return [
    `git merge --no-ff --no-verify --no-edit -m "${message}" ${taskBranch}`,
    'si conflit : git merge --abort (ta copie revient telle quelle)',
  ];
}

/** Fusion `--no-ff` de la branche de la tâche ; en cas d'échec, `git merge --abort`. */
export async function mergeTask(
  run: Runner,
  root: string,
  taskBranch: string,
  message: string,
  signal?: AbortSignal,
): Promise<{ ok: true; merge: string } | { ok: false; detail: string }> {
  const merge = await git(
    run,
    root,
    ['merge', '--no-ff', '--no-verify', '--no-edit', '-m', message, taskBranch],
    `git merge --no-ff --no-verify --no-edit -m "${message}" ${taskBranch}`,
    signal,
  );
  if (merge.code !== 0) {
    await git(run, root, ['merge', '--abort'], 'git merge --abort');
    return { ok: false, detail: detail(merge) };
  }
  const head = await git(run, root, ['rev-parse', 'HEAD'], 'git rev-parse HEAD');
  return { ok: true, merge: head.stdout.trim() };
}

export function revertCommands(merge: string): string[] {
  return [
    `git revert -m 1 --no-edit ${merge.slice(0, 12)}`,
    'si conflit : git revert --abort (ta copie revient telle quelle)',
  ];
}

/** Annule une application par un nouveau commit (`git revert -m 1`) : l'historique reste intact. */
export async function revertMerge(
  run: Runner,
  root: string,
  merge: string,
  signal?: AbortSignal,
): Promise<{ ok: true; commit: string } | { ok: false; detail: string }> {
  if (!/^[0-9a-f]{7,40}$/i.test(merge)) return { ok: false, detail: 'commit invalide' };
  const outcome = await git(
    run,
    root,
    ['revert', '-m', '1', '--no-edit', merge],
    `git revert -m 1 --no-edit ${merge.slice(0, 12)}`,
    signal,
  );
  if (outcome.code !== 0) {
    await git(run, root, ['revert', '--abort'], 'git revert --abort');
    return { ok: false, detail: detail(outcome) };
  }
  const head = await git(run, root, ['rev-parse', 'HEAD'], 'git rev-parse HEAD');
  return { ok: true, commit: head.stdout.trim() };
}
