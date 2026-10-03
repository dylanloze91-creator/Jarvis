import { existsSync } from 'node:fs';
import {
  classifyCommand,
  randomId,
  resolveMaxFixAttempts,
  sandboxBranch,
  suiteSetOf,
  type ProjectProfile,
  type Settings,
  type ToolCallOutcome,
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
import {
  ApplyError,
  applyCommands,
  checkApply,
  mergeMessage,
  mergeTask,
  revertCommands,
  revertMerge,
} from './apply.js';
import { defaultWorktreeRoot, listSandboxes, pruneWorktrees, samePath } from './sandbox.js';
import { TASK_STEPS, TaskRun } from './taskFlow.js';
import type { AddStepFn, TaskDeps, TaskHooks, TaskHost } from './taskRun.js';

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

/** Projet d'une tâche lancée par une mission (0.5.3) : sa copie, son profil. Absent = Jarvis. */
export interface TaskProject {
  id: string;
  root: string;
  profile: ProjectProfile;
}

interface ToolRepo {
  root: string;
  worktreeRoot: string;
}

export interface CodeTaskDeps extends TaskDeps {
  settings(): Settings;
  logsDir(): string;
  freeBytes(path: string): Promise<number | null>;
  now?(): Date;
}

/** Tâches de code : une à la fois, chacune dans sa copie isolée. La copie de l'utilisateur ne change qu'avec « Appliquer », après sa carte. */
export class CodeTaskWorkflow {
  private current: TaskRun | null = null;
  private sandboxes: SandboxView[] | null = null;
  private repoRootValue: string | null = null;
  /** Dépôt des outils de copie isolée pour l'opération en cours (Jarvis ou le projet de la tâche). */
  private toolRepo: ToolRepo | null = null;
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
      repoRoot: () => this.toolRepo?.root ?? this.repoRootValue,
      worktreeRoot: () => this.toolRepo?.worktreeRoot ?? (this.worktreeRoot() || null),
      node: () => host.node(),
      freeBytes: deps.freeBytes,
      listSandboxes: async () => {
        const repo = this.toolRepo ?? this.jarvisRepo();
        return repo ? listSandboxes(deps.run, repo.root, repo.worktreeRoot) : [];
      },
    });
  }

  private jarvisRepo(): ToolRepo | null {
    return this.repoRootValue
      ? { root: this.repoRootValue, worktreeRoot: this.worktreeRoot() }
      : null;
  }

  private runRepo(run: TaskRun): ToolRepo {
    return { root: run.repoRoot, worktreeRoot: run.tasksRoot };
  }

  worktreeRoot(): string {
    const developer = this.deps.settings().developer;
    const repo = this.repoRootValue ?? developer.repoPath;
    return developer.worktreeRoot.trim() || (repo ? defaultWorktreeRoot(repo) : '');
  }

  view(): Pick<DeveloperState, 'codeTask' | 'sandboxes' | 'worktreeRoot'> {
    // Une copie gardée n'appartient plus à la tâche affichée : elle rejoint les anciennes tâches.
    const open = this.current && !this.current.state.closed ? this.current : null;
    const path = open?.sandbox?.path ?? null;
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
    tasksRoot: string,
    request: string,
  ): Promise<{ branch: string; folder: string }> {
    const base = sandboxBranch(this.deps.now ? this.deps.now() : new Date(), request);
    for (let n = 1; n < 50; n += 1) {
      const branch = n === 1 ? base : `${base}-${n}`;
      const folder = branch.slice('jarvis-dev/'.length);
      const taken = await this.git(root, ['branch', '--list', branch], 'git branch --list');
      if (!taken.trim() && !existsSync(`${tasksRoot}/${folder}`)) return { branch, folder };
    }
    throw new Error('Trop de tâches du même nom aujourd’hui : jette les anciennes.');
  }

  /** `options` : tâche lancée par une mission (modèle du CODER, points d'accroche, projet). */
  async start(
    request: string,
    options: { model?: string; hooks?: TaskHooks; project?: TaskProject } = {},
  ): Promise<DeveloperState> {
    const text = request.trim();
    if (text.length < 8) return this.host.notice('Décris la modification en une phrase au moins.');
    if (text.length > 2_000)
      return this.host.notice('Demande trop longue (2 000 caractères au plus).');
    const model = options.model ?? this.deps.settings().developer.codeModel;
    if (!model)
      return this.host.notice(
        'Choisis d’abord un modèle de code (onglet « Modèle de code », étape 6).',
      );
    const status = await this.deps.ollama().status();
    if (!status.models.some((m) => m.name === model))
      return this.host.notice(`Le modèle de code « ${model} » n’est pas installé dans Ollama.`);
    const project = options.project;
    if (project && suiteSetOf(project.profile).ids.length === 0)
      return this.host.notice(
        `Le projet « ${project.profile.label} » n’a ni script « typecheck » ni script « test » : Jarvis ne pourrait rien vérifier.`,
      );
    const root = project ? project.root : await this.host.repoRoot();
    if (!root)
      return this.host.notice(
        'Choisis et vérifie d’abord la copie de travail (Réglages → Développeur).',
      );
    if (!project) this.repoRootValue = root;
    const tasksRoot = project ? defaultWorktreeRoot(project.root) : this.worktreeRoot();
    if (!tasksRoot) return this.host.notice('Dossier des copies isolées introuvable.');
    const { branch, folder } = await this.uniqueName(root, tasksRoot, text);
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
      maxAttempts: resolveMaxFixAttempts(this.deps.settings().developer.maxFixAttempts),
      testSeriesUsed: 0,
      findings: [],
      pauses: [],
      planApproved: [],
      asked: 0,
      report: null,
      closed: null,
      startedAt: Date.now(),
      finishedAt: null,
      ...(project ? { projectId: project.id } : {}),
    };
    const run = new TaskRun(
      this.host,
      this.deps,
      state,
      this.manager,
      { root, worktreeRoot: tasksRoot, folder, tracked, dirty },
      options.hooks,
      project?.profile,
    );
    this.current = run;
    this.toolRepo = this.runRepo(run);
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
    this.toolRepo = this.runRepo(run);
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
    this.toolRepo = this.runRepo(run);
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

  async keep(): Promise<DeveloperState> {
    const run = this.finished();
    if (!run) return this.host.notice('Aucune tâche terminée à garder.');
    run.state.closed = 'kept';
    if (this.repoRootValue && !run.state.projectId) {
      this.sandboxes = (
        await listSandboxes(this.deps.run, this.repoRootValue, this.worktreeRoot())
      ).map((s) => ({ ...s, current: false }));
    }
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
    this.toolRepo = this.jarvisRepo();
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

  private record(name: string, args: Record<string, unknown>, ok: boolean, content: string): void {
    const outcome: ToolCallOutcome = {
      callId: randomId(),
      name,
      status: ok ? 'ok' : 'denied',
      content,
      arguments: args,
      decision: ok ? 'approved' : 'refused',
      durationMs: 0,
      outcome: ok ? 'success' : 'cancelled',
    };
    this.host.audit(outcome);
  }

  /**
   * « Appliquer » (0.5.3) : fusion `--no-ff` de la branche de la tâche dans la
   * copie de l'utilisateur (Jarvis ou le projet), après sa carte. Copie propre
   * exigée ; en cas de conflit, la fusion est annulée. Jamais de push.
   */
  async apply(): Promise<DeveloperState> {
    const run = this.current;
    if (!run || run.state.finishedAt === null || !run.sandbox || run.state.closed === 'discarded')
      return this.host.notice('Aucune tâche terminée à appliquer.');
    if (run.state.report?.verdict !== 'success')
      return this.host.notice(
        'Seule une tâche réussie (tests sans nouvel échec) peut être appliquée.',
      );
    if (run.state.applied && run.state.applied.revertedAt === null)
      return this.host.notice('Cette tâche est déjà appliquée.');
    const { branch, baseCommit, request } = run.state;
    const root = run.repoRoot;
    return this.host.runTask(
      'apply',
      `Appliquer ${branch}`,
      [
        { id: 'check', label: 'Ta copie : propre, sur une branche' },
        { id: 'confirm', label: 'Ta confirmation (toujours demandée)' },
        { id: 'merge', label: 'Fusion (git merge --no-ff), sans publication' },
      ],
      async (step, signal) => {
        step('check', 'running', root);
        const target = await checkApply(this.deps.run, root, branch, baseCommit ?? '');
        step('check', 'done', `${target.ahead} commit(s) à fusionner dans ${target.branch}`);
        const message = mergeMessage(request, branch);
        const commands = applyCommands(branch, message);
        step('confirm', 'running', 'ta confirmation');
        const approved = await this.host.ask(
          {
            callId: randomId(),
            toolName: 'dev_apply_task',
            title: 'Appliquer la tâche à ta copie',
            details: `Fusionner la branche ${branch} dans « ${target.branch} » de ${root}. Rien n’est publié (aucun push). Pour revenir en arrière : « Annuler l’application » (git revert).`,
            command: `${commands.join('\n')}\n(dans ${root})`,
            forced: true,
          },
          {
            safety: classifyCommand(commands[0]!),
            reason: 'appliquer à ta copie : toujours confirmé',
            diff: run.state.diff,
          },
          signal,
        );
        this.record(
          'dev_apply_task',
          { branch, root, target: target.branch },
          approved,
          approved
            ? `Application acceptée : ${branch} → ${target.branch}.`
            : `Application refusée : ${branch}.`,
        );
        if (!approved) {
          step('confirm', 'failed', 'refusée');
          step('merge', 'skipped');
          return 'Application refusée : ta copie n’a pas changé.';
        }
        step('confirm', 'done', 'acceptée');
        step('merge', 'running');
        const result = await mergeTask(this.deps.run, root, branch, message, signal);
        if (!result.ok) {
          step('merge', 'failed', 'fusion annulée (git merge --abort)');
          throw new ApplyError(
            `La fusion a échoué et a été annulée : ta copie n’a pas changé. ${result.detail}`,
          );
        }
        run.state.applied = {
          at: Date.now(),
          root,
          branch: target.branch,
          preHead: target.head,
          merge: result.merge,
          revertedAt: null,
          revert: null,
        };
        if (run.state.report)
          run.state.report.markdown += `\n\n### Application\n\nFusionnée dans « ${target.branch} » de \`${root}\` : commit \`${result.merge.slice(0, 7)}\` (avant : \`${target.head.slice(0, 7)}\`). Rien n’est publié.\nPour annuler : « Annuler l’application », ou \`git revert -m 1 ${result.merge.slice(0, 12)}\` dans ta copie.\n`;
        step('merge', 'done', result.merge.slice(0, 7));
        return `Appliquée : ${branch} fusionnée dans ${target.branch} (${result.merge.slice(0, 7)}). Rien n’est publié.`;
      },
    );
  }

  /** Annule une application par `git revert -m 1` (nouveau commit), après la carte. */
  async revertApply(): Promise<DeveloperState> {
    const run = this.current;
    const applied = run?.state.applied;
    if (!run || !applied || applied.revertedAt !== null)
      return this.host.notice('Aucune application à annuler.');
    return this.host.runTask(
      'revert',
      `Annuler l’application ${applied.merge.slice(0, 7)}`,
      [
        { id: 'check', label: 'Ta copie : propre' },
        { id: 'confirm', label: 'Ta confirmation (toujours demandée)' },
        { id: 'revert', label: 'Annulation (git revert -m 1)' },
      ],
      async (step, signal) => {
        step('check', 'running', applied.root);
        const status = await this.deps.run({
          program: 'git',
          args: [...GIT_SAFE, 'status', '--porcelain=v1'],
          cwd: applied.root,
          display: 'git status --porcelain=v1',
          timeoutMs: 30_000,
        });
        const changed = status.stdout.split('\n').filter((l) => l.trim() && !l.startsWith('??'));
        if (status.code !== 0 || changed.length)
          throw new ApplyError(
            'Ta copie a des modifications non enregistrées : enregistre-les ou mets-les de côté, puis réessaie.',
          );
        step('check', 'done');
        const commands = revertCommands(applied.merge);
        step('confirm', 'running', 'ta confirmation');
        const approved = await this.host.ask(
          {
            callId: randomId(),
            toolName: 'dev_revert_apply',
            title: 'Annuler l’application',
            details: `Créer un commit qui annule la fusion ${applied.merge.slice(0, 7)} dans ${applied.root}. L’historique reste intact ; rien n’est publié.`,
            command: `${commands.join('\n')}\n(dans ${applied.root})`,
            forced: true,
          },
          {
            safety: classifyCommand(commands[0]!),
            reason: 'annuler une application : toujours confirmé',
          },
          signal,
        );
        this.record(
          'dev_revert_apply',
          { merge: applied.merge, root: applied.root },
          approved,
          approved
            ? `Annulation acceptée : ${applied.merge}.`
            : `Annulation refusée : ${applied.merge}.`,
        );
        if (!approved) {
          step('confirm', 'failed', 'refusée');
          step('revert', 'skipped');
          return 'Annulation refusée : ta copie n’a pas changé.';
        }
        step('confirm', 'done', 'acceptée');
        step('revert', 'running');
        const result = await revertMerge(this.deps.run, applied.root, applied.merge, signal);
        if (!result.ok) {
          step('revert', 'failed', 'annulation interrompue (git revert --abort)');
          throw new ApplyError(`git revert a échoué et a été interrompu : ${result.detail}`);
        }
        applied.revertedAt = Date.now();
        applied.revert = result.commit;
        step('revert', 'done', result.commit.slice(0, 7));
        return `Application annulée par le commit ${result.commit.slice(0, 7)}.`;
      },
    );
  }
}
