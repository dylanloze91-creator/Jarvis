import { existsSync } from 'node:fs';
import {
  MAX_FIX_ATTEMPTS,
  classifyCommand,
  randomId,
  sandboxBranch,
  type Settings,
  type ToolManager,
} from '@jarvis/core';
import type {
  CodeTaskState,
  DevStepStatus,
  DevTaskKind,
  DeveloperState,
  SandboxView,
} from '../../../shared/developerIpc.js';
import { createTaskToolManager } from '../tools/taskTools.js';
import { GIT_SAFE } from '../tools/common.js';
import { defaultWorktreeRoot, listSandboxes, pruneWorktrees, samePath } from './sandbox.js';
import { TASK_STEPS, TaskRun } from './taskFlow.js';
import type { AddStepFn, TaskDeps, TaskHost } from './taskRun.js';

export interface CodeTaskHost extends TaskHost {
  runTask(
    kind: DevTaskKind,
    title: string,
    steps: ReadonlyArray<{ id: string; label: string }>,
    work: (
      step: (id: string, status: DevStepStatus, detail?: string) => void,
      signal: AbortSignal,
      addStep: AddStepFn,
    ) => Promise<string>,
  ): Promise<DeveloperState>;
  notice(message: string): DeveloperState;
  /** Copie de travail vérifiée (revérifiée après un redémarrage). */
  repoRoot(): Promise<string | null>;
}

export interface CodeTaskDeps extends TaskDeps {
  settings(): Settings;
  logsDir(): string;
  freeBytes(path: string): Promise<number | null>;
  now?(): Date;
}

/** Tâches de code : une à la fois, chacune dans sa copie isolée. La copie de l'utilisateur n'est jamais touchée. */
export class CodeTaskWorkflow {
  private current: TaskRun | null = null;
  private sandboxes: SandboxView[] | null = null;
  private repoRootValue: string | null = null;
  private readonly manager: ToolManager;

  constructor(
    private readonly host: CodeTaskHost,
    private readonly deps: CodeTaskDeps,
  ) {
    this.manager = createTaskToolManager({
      run: deps.run,
      logsDir: deps.logsDir,
      sandbox: () => this.current?.sandbox ?? null,
      setSandbox: (sandbox) => {
        if (this.current) this.current.sandbox = sandbox;
      },
      repoRoot: () => this.repoRootValue,
      worktreeRoot: () => this.worktreeRoot() || null,
      node: () => host.node(),
      freeBytes: deps.freeBytes,
      listSandboxes: async () =>
        this.repoRootValue ? listSandboxes(deps.run, this.repoRootValue, this.worktreeRoot()) : [],
    });
  }

  worktreeRoot(): string {
    const developer = this.deps.settings().developer;
    const repo = this.repoRootValue ?? developer.repoPath;
    return developer.worktreeRoot.trim() || (repo ? defaultWorktreeRoot(repo) : '');
  }

  view(): Pick<DeveloperState, 'codeTask' | 'sandboxes' | 'worktreeRoot'> {
    const path = this.current?.sandbox?.path ?? null;
    return {
      codeTask: this.current?.state ?? null,
      sandboxes:
        this.sandboxes?.map((s) => ({ ...s, current: path !== null && samePath(s.path, path) })) ??
        null,
      worktreeRoot: this.worktreeRoot(),
    };
  }

  private async git(root: string, args: string[], display: string): Promise<string> {
    const outcome = await this.deps.run({
      program: 'git',
      args: [...GIT_SAFE, ...args],
      cwd: root,
      display,
      timeoutMs: 30_000,
      maxBytes: 4_000_000,
    });
    return outcome.code === 0 ? outcome.stdout : '';
  }

  private async uniqueName(
    root: string,
    request: string,
  ): Promise<{ branch: string; folder: string }> {
    const base = sandboxBranch(this.deps.now ? this.deps.now() : new Date(), request);
    for (let n = 1; n < 50; n += 1) {
      const branch = n === 1 ? base : `${base}-${n}`;
      const folder = branch.slice('jarvis-dev/'.length);
      const taken = await this.git(root, ['branch', '--list', branch], 'git branch --list');
      if (!taken.trim() && !existsSync(`${this.worktreeRoot()}/${folder}`))
        return { branch, folder };
    }
    throw new Error('Trop de tâches du même nom aujourd’hui : jette les anciennes.');
  }

  async start(request: string): Promise<DeveloperState> {
    const text = request.trim();
    if (text.length < 8) return this.host.notice('Décris la modification en une phrase au moins.');
    if (text.length > 2_000)
      return this.host.notice('Demande trop longue (2 000 caractères au plus).');
    const model = this.deps.settings().developer.codeModel;
    if (!model)
      return this.host.notice(
        'Choisis d’abord un modèle de code (onglet « Modèle de code », étape 6).',
      );
    const status = await this.deps.ollama().status();
    if (!status.models.some((m) => m.name === model))
      return this.host.notice(`Le modèle de code « ${model} » n’est pas installé dans Ollama.`);
    const root = await this.host.repoRoot();
    if (!root)
      return this.host.notice(
        'Choisis et vérifie d’abord la copie de travail (Réglages → Développeur).',
      );
    this.repoRootValue = root;
    if (!this.worktreeRoot()) return this.host.notice('Dossier des copies isolées introuvable.');
    const { branch, folder } = await this.uniqueName(root, text);
    const tracked = new Set(
      (await this.git(root, ['ls-tree', '-r', '--name-only', 'HEAD'], 'git ls-tree'))
        .split('\n')
        .filter(Boolean),
    );
    const dirty = new Set(
      (await this.git(root, ['status', '--porcelain=v1'], 'git status'))
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.slice(3).trim()),
    );
    const state: CodeTaskState = {
      id: randomId(),
      request: text,
      model,
      status: 'planning',
      branch,
      worktreePath: '',
      baseCommit: null,
      plan: null,
      approvedAt: null,
      checkpoints: [],
      diff: [],
      baseline: null,
      runs: [],
      attempts: 0,
      maxAttempts: MAX_FIX_ATTEMPTS,
      testSeriesUsed: 0,
      findings: [],
      pauses: [],
      planApproved: [],
      asked: 0,
      report: null,
      closed: null,
      startedAt: Date.now(),
      finishedAt: null,
    };
    const run = new TaskRun(this.host, this.deps, state, this.manager, {
      root,
      worktreeRoot: this.worktreeRoot(),
      folder,
      tracked,
      dirty,
    });
    this.current = run;
    const title = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    return this.host.runTask('code', `Tâche : ${title}`, TASK_STEPS, (step, signal, addStep) =>
      run.run(step, signal, addStep),
    );
  }

  approve(approved: boolean): DeveloperState {
    if (!this.current?.approve(approved))
      return this.host.notice('Aucun plan en attente de validation.');
    return this.host.emit();
  }

  private finished(): TaskRun | null {
    const run = this.current;
    return run && run.state.finishedAt !== null && run.sandbox && !run.state.closed ? run : null;
  }

  async rollback(checkpoint: string): Promise<DeveloperState> {
    const run = this.finished();
    if (!run) return this.host.notice('Aucune tâche terminée avec une copie isolée.');
    return this.host.runTask(
      'rollback',
      `Revenir au point de reprise ${checkpoint.slice(0, 7)}`,
      [{ id: 'rollback', label: 'Retour arrière (toujours confirmé)' }],
      async (step, signal) => {
        step('rollback', 'running', 'ta confirmation');
        const message = await run.rollbackTo(checkpoint, signal);
        step('rollback', 'done');
        return message;
      },
    );
  }

  async discard(): Promise<DeveloperState> {
    const run = this.finished();
    if (!run) return this.host.notice('Aucune tâche terminée avec une copie isolée.');
    return this.host.runTask(
      'discard',
      `Jeter la tâche ${run.state.branch}`,
      [{ id: 'discard', label: 'Supprimer la copie isolée et sa branche (toujours confirmé)' }],
      async (step, signal) => {
        step('discard', 'running', 'ta confirmation');
        const message = await run.discardSandbox(signal);
        step('discard', 'done');
        this.sandboxes = null;
        return message;
      },
    );
  }

  keep(): DeveloperState {
    const run = this.finished();
    if (!run) return this.host.notice('Aucune tâche terminée à garder.');
    run.state.closed = 'kept';
    return this.host.notice(
      `Branche ${run.state.branch} gardée dans ${run.state.worktreePath}. Tu pourras la jeter plus tard (Anciennes tâches).`,
    );
  }

  async listSandboxes(): Promise<DeveloperState> {
    const root = await this.host.repoRoot();
    if (!root) return this.host.notice('Choisis et vérifie d’abord la copie de travail.');
    this.repoRootValue = root;
    this.sandboxes = (await listSandboxes(this.deps.run, root, this.worktreeRoot())).map((s) => ({
      ...s,
      current: false,
    }));
    return this.host.emit();
  }

  /** Jette les anciennes copies isolées choisies : une confirmation par copie, puis `git worktree prune`. */
  async cleanSandboxes(paths: string[]): Promise<DeveloperState> {
    const root = await this.host.repoRoot();
    if (!root) return this.host.notice('Choisis et vérifie d’abord la copie de travail.');
    this.repoRootValue = root;
    const known = await listSandboxes(this.deps.run, root, this.worktreeRoot());
    const active = this.current && !this.current.state.closed ? this.current.sandbox?.path : null;
    const chosen = known.filter(
      (s) => paths.some((p) => samePath(p, s.path)) && !(active && samePath(active, s.path)),
    );
    if (chosen.length === 0) return this.host.notice('Aucune ancienne tâche à nettoyer.');
    return this.host.runTask(
      'cleanup',
      'Nettoyer les anciennes tâches',
      chosen.map((s, i) => ({
        id: `s${i}`,
        label: `${s.branch}${s.missing ? ' (dossier disparu)' : ''}`,
      })),
      async (step, signal) => {
        let removed = 0;
        let prune = false;
        for (const [i, sandbox] of chosen.entries()) {
          if (sandbox.missing) {
            prune = true;
            step(`s${i}`, 'done', 'à oublier (git worktree prune)');
            continue;
          }
          step(`s${i}`, 'running', 'ta confirmation');
          const outcome = await this.manager.execute(
            {
              id: randomId(),
              name: 'dev_discard_sandbox',
              arguments: { path: sandbox.path, branch: sandbox.branch },
            },
            {
              signal,
              requestConfirmation: (request) =>
                this.host.ask(
                  request,
                  {
                    safety: classifyCommand((request.command ?? '').split('\n')[0] ?? '', {
                      insideSandbox: true,
                      branch: sandbox.branch,
                    }),
                    reason: 'jeter une ancienne tâche : toujours confirmé',
                  },
                  signal,
                ),
              onProgress: (line) => this.host.log(line),
            },
          );
          this.host.audit(outcome);
          if (outcome.status === 'ok') removed += 1;
          step(
            `s${i}`,
            outcome.status === 'ok' ? 'done' : 'failed',
            outcome.content.split('\n')[0],
          );
        }
        if (prune) {
          const request = {
            callId: randomId(),
            toolName: 'git_worktree_prune',
            title: 'Oublier les copies disparues',
            details: 'Retirer de git les copies isolées dont le dossier a disparu.',
            command: 'git worktree prune',
            forced: true,
          };
          const ok = await this.host.ask(
            request,
            {
              safety: classifyCommand('git worktree prune'),
              reason: 'maintenance git : toujours confirmé',
            },
            signal,
          );
          if (ok) await pruneWorktrees(this.deps.run, root);
        }
        this.sandboxes = (await listSandboxes(this.deps.run, root, this.worktreeRoot())).map(
          (s) => ({
            ...s,
            current: false,
          }),
        );
        return `${removed} copie(s) isolée(s) jetée(s).`;
      },
    );
  }
}
