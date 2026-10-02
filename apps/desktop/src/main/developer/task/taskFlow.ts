import {
  CodeModelFormatError,
  MAX_TEST_SERIES,
  SCAN_LABELS,
  approvalFromPlan,
  compareRuns,
  createCodeAIProvider,
  editPrompt,
  editSystemPrompt,
  findingKey,
  fixPrompt,
  fixSystemPrompt,
  parsePlanReply,
  parseUnifiedDiff,
  planPrompt,
  planSystemPrompt,
  randomId,
  reviewPlan,
  scanDiff,
  suiteCommand,
  toolView,
  trimDiffFiles,
  type CodeAIProvider,
  type TaskPlan,
  type TestRunSummary,
  type ToolManager,
} from '@jarvis/core';
import { join } from 'node:path';
import type { CodeTaskRun, CodeTaskState } from '../../../shared/developerIpc.js';
import { TASK_MODEL_TOOLS } from '../tools/taskTools.js';
import { buildTaskReport } from './report.js';
import { SANDBOX_NPM_CI_ARGS } from './suites.js';
import {
  TaskRunBase,
  type AddStepFn,
  type StepFn,
  type TaskDeps,
  type TaskHost,
} from './taskRun.js';

export const TASK_STEPS = [
  { id: 'model', label: 'Modèle de code' },
  { id: 'plan', label: 'Plan (lecture du dépôt, rien n’est modifié)' },
  { id: 'approval', label: 'Ta validation du plan' },
  { id: 'sandbox', label: 'Copie isolée (branche jarvis-dev/*)' },
  { id: 'install', label: 'Dépendances de la copie isolée' },
  { id: 'baseline', label: 'Tests de référence (avant modification)' },
  { id: 'edit', label: 'Modification' },
  { id: 'scan', label: 'Revue du diff avant les tests' },
  { id: 'test', label: 'Tests' },
  { id: 'report', label: 'Rapport' },
] as const;

export class TaskStopped extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskStopped';
  }
}

export interface TaskRepo {
  root: string;
  worktreeRoot: string;
  folder: string;
  /** Fichiers suivis au dernier commit (la copie isolée part de là). */
  tracked: Set<string>;
  /** Fichiers modifiés et non enregistrés dans la copie de l'utilisateur. */
  dirty: Set<string>;
}

export class TaskRun extends TaskRunBase {
  private approvalWaiter: ((ok: boolean) => void) | null = null;
  private readonly acknowledged = new Set<string>();

  constructor(
    host: TaskHost,
    deps: TaskDeps,
    state: CodeTaskState,
    manager: ToolManager,
    private readonly repo: TaskRepo,
  ) {
    super(host, deps, state, manager);
  }

  get awaitingApproval(): boolean {
    return this.approvalWaiter !== null;
  }

  approve(approved: boolean): boolean {
    const waiter = this.approvalWaiter;
    if (!waiter) return false;
    this.approvalWaiter = null;
    waiter(approved);
    return true;
  }

  private waitApproval(signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const abort = (): void => {
        this.approvalWaiter = null;
        resolve(false);
      };
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
      this.approvalWaiter = (ok) => {
        signal.removeEventListener('abort', abort);
        resolve(ok);
      };
    });
  }

  private async makePlan(
    code: CodeAIProvider,
    signal: AbortSignal,
    pause: () => Promise<void>,
  ): Promise<TaskPlan> {
    const tools = this.host.readTools();
    const first = await code.runTools({
      tools,
      system: planSystemPrompt(),
      prompt: planPrompt(this.state.request),
      maxRounds: 10,
      signal,
      beforeRound: pause,
    });
    if (first.stoppedBy === 'error')
      throw new Error(`Le modèle de code n’a pas répondu : ${first.error}`);
    try {
      return parsePlanReply(first.finalText);
    } catch (error) {
      if (!(error instanceof CodeModelFormatError)) throw error;
      const read = first.calls
        .filter((c) => c.status === 'ok')
        .map((c) => `${c.name} ${JSON.stringify(c.arguments)}`)
        .slice(0, 12)
        .join('\n');
      const retry = await code.runTools({
        tools: toolView(tools, []),
        system: planSystemPrompt(),
        prompt: `${planPrompt(this.state.request)}\n\nDéjà consulté :\n${read || '—'}\n\nTa réponse précédente n’était pas un plan valide (${error.message}). Réponds seulement par le bloc JSON du plan.`,
        maxRounds: 1,
        signal,
        beforeRound: pause,
      });
      if (retry.stoppedBy === 'error')
        throw new Error(`Le modèle de code n’a pas répondu : ${retry.error}`);
      return parsePlanReply(retry.finalText);
    }
  }

  private async refreshDiff(signal: AbortSignal): Promise<string> {
    const diff = await this.sandbox!.diff(signal);
    this.state.diff = trimDiffFiles(parseUnifiedDiff(diff));
    return diff;
  }

  private async checkpoint(label: string, signal: AbortSignal): Promise<void> {
    const checkpoint = await this.sandbox!.checkpoint(label, signal);
    if (checkpoint) this.state.checkpoints.push(checkpoint);
    await this.refreshDiff(signal);
  }

  /** Revue du diff avant chaque série de tests : un code sensible nouveau demande ton accord. */
  private async scanGate(step: StepFn, signal: AbortSignal): Promise<void> {
    const diff = await this.refreshDiff(signal);
    const fresh = scanDiff(diff).filter((f) => !this.acknowledged.has(findingKey(f)));
    if (fresh.length === 0) {
      step('scan', 'done', this.state.findings.length ? 'rien de nouveau' : 'rien de sensible');
      return;
    }
    step('scan', 'running', `${fresh.length} point(s) sensible(s) : ta confirmation`);
    this.state.asked += 1;
    const labels = [...new Set(fresh.map((f) => SCAN_LABELS[f.category]))];
    const request = {
      callId: randomId(),
      toolName: 'dev_review_diff',
      title: 'Revue du diff',
      details: `Le diff contient : ${labels.join(', ')}. Lancer les tests exécutera ce code avec tes droits Windows.`,
      command: fresh.map((f) => `${f.file}:${f.line}  ${f.text}`).join('\n'),
      forced: true,
    };
    const approved = await this.host.ask(
      request,
      {
        safety: {
          command: 'tests après revue du diff',
          level: 'always-confirm',
          label: 'Toujours à confirmer',
          reasons: labels,
          runsWithoutAsking: false,
        },
        reason: 'revue du diff avant les tests (décision 9)',
        findings: fresh,
      },
      signal,
    );
    this.host.audit({
      callId: request.callId,
      name: 'dev_review_diff',
      status: approved ? 'ok' : 'denied',
      content: `${approved ? 'Tests autorisés' : 'Tests refusés'} malgré : ${labels.join(', ')}.`,
      arguments: { points: fresh.length },
      decision: approved ? 'approved' : 'refused',
      durationMs: 0,
      outcome: approved ? 'success' : 'cancelled',
    });
    if (!approved) {
      step('scan', 'failed', 'tests refusés');
      throw new TaskStopped('Tests non lancés : tu as refusé le code sensible du diff.');
    }
    for (const finding of fresh) this.acknowledged.add(findingKey(finding));
    this.state.findings.push(...fresh);
    step('scan', 'done', 'autorisé par toi');
  }

  private async testSeries(
    stepId: string,
    step: StepFn,
    signal: AbortSignal,
    pause: () => Promise<void>,
  ): Promise<TestRunSummary[]> {
    this.series += 1;
    this.state.testSeriesUsed = this.series;
    const results: TestRunSummary[] = [];
    for (const suite of this.reviewed!.tests) {
      await pause();
      step(stepId, 'running', `${suiteCommand(suite)}…`);
      const outcome = await this.call('dev_run_tests', { suite }, signal);
      if (outcome.status !== 'ok') throw new TaskStopped(outcome.content);
      results.push(outcome.data as TestRunSummary);
    }
    return results;
  }

  private async testRun(
    label: string,
    stepId: string,
    step: StepFn,
    signal: AbortSignal,
    pause: () => Promise<void>,
  ): Promise<CodeTaskRun> {
    const results = await this.testSeries(stepId, step, signal, pause);
    const comparison = compareRuns(this.state.baseline ?? [], results);
    const run: CodeTaskRun = {
      label,
      at: Date.now(),
      results,
      newFailures: comparison.newFailures,
      fixed: comparison.fixed,
      ok: comparison.ok,
    };
    this.state.runs.push(run);
    step(
      stepId,
      run.ok ? 'done' : 'failed',
      run.ok
        ? results.map((r) => `${r.suite} : ${r.summary}`).join(' · ')
        : `${run.newFailures.length} nouvel(s) échec(s)`,
    );
    return run;
  }

  /** Retour à un point de reprise : toujours confirmé (carte avec les commandes exactes). */
  async rollbackTo(checkpoint: string, signal: AbortSignal): Promise<string> {
    if (!this.sandbox) throw new Error('La copie isolée n’existe plus.');
    const index = this.state.checkpoints.findIndex((c) => c.sha === checkpoint);
    const target =
      index >= 0 ? checkpoint : checkpoint === this.state.baseCommit ? checkpoint : null;
    if (!target) throw new Error('Point de reprise inconnu.');
    const outcome = await this.call('dev_rollback', { checkpoint: target }, signal);
    if (outcome.status !== 'ok') throw new Error(outcome.content);
    this.state.checkpoints = index >= 0 ? this.state.checkpoints.slice(0, index + 1) : [];
    await this.refreshDiff(signal);
    return outcome.content;
  }

  /** Jeter la copie isolée et sa branche : toujours confirmé. */
  async discardSandbox(signal: AbortSignal): Promise<string> {
    if (!this.sandbox) throw new Error('La copie isolée n’existe plus.');
    const outcome = await this.call(
      'dev_discard_sandbox',
      { path: this.sandbox.path, branch: this.sandbox.branch },
      signal,
    );
    if (outcome.status !== 'ok') throw new Error(outcome.content);
    this.state.closed = 'discarded';
    return outcome.content;
  }

  private finish(step: StepFn, verdict: 'success' | 'failed' | 'stopped', reason?: string): string {
    this.state.finishedAt = Date.now();
    if (this.state.status !== 'cancelled' && this.state.status !== 'refused')
      this.state.status = verdict === 'success' ? 'finished' : 'failed';
    this.state.report = { markdown: buildTaskReport(this.state, verdict, reason), verdict };
    step('report', 'done');
    this.host.emit();
    if (verdict === 'success')
      return 'Tâche réussie : vois le rapport. Ta copie de travail n’a pas été touchée.';
    if (verdict === 'failed')
      return `Des tests échouent encore après ${this.state.attempts} correction(s) : vois le rapport. Ta copie de travail n’a pas été touchée.`;
    return `Tâche arrêtée${reason ? ` : ${reason}` : ''}.`;
  }

  /** Déroulé complet. Toute écriture a lieu dans la copie isolée ; la copie de l'utilisateur n'est jamais modifiée. */
  async run(step: StepFn, signal: AbortSignal, addStep: AddStepFn): Promise<string> {
    try {
      return await this.flow(step, signal, addStep);
    } catch (error) {
      const cancelled = signal.aborted;
      if (cancelled) this.state.status = 'cancelled';
      const reason = cancelled
        ? 'Annulée.'
        : error instanceof Error
          ? error.message
          : String(error);
      if (this.state.report) throw error;
      if (this.state.approvedAt !== null || cancelled) this.finish(step, 'stopped', reason);
      else this.state.status = 'failed';
      throw error;
    }
  }

  private async flow(step: StepFn, signal: AbortSignal, addStep: AddStepFn): Promise<string> {
    const state = this.state;
    const ollama = this.deps.ollama();
    const code = createCodeAIProvider(this.deps.registry, {
      model: state.model,
      baseUrl: ollama.baseUrl,
      options: this.deps.modelOptions(state.model),
    });
    const pause = () => this.yieldToChat(signal, addStep, step);
    step('model', 'done', state.model);

    step('plan', 'running', 'lecture du dépôt');
    const plan = await this.makePlan(code, signal, pause);
    this.reviewed = reviewPlan(plan, (path) => this.repo.tracked.has(path));
    const reviewed = this.reviewed;
    state.plan = {
      summary: reviewed.summary,
      criteria: reviewed.criteria,
      files: reviewed.files,
      tests: reviewed.tests,
      testCommands: reviewed.tests.map(suiteCommand),
      maxTestSeries: MAX_TEST_SERIES,
      dirtyFiles: reviewed.files.map((f) => f.path).filter((p) => this.repo.dirty.has(p)),
      branchCommand: `git worktree add -b ${state.branch} "${join(this.repo.worktreeRoot, this.repo.folder)}" HEAD`,
      installCommand: `npm ${SANDBOX_NPM_CI_ARGS.join(' ')}`,
    };
    step('plan', 'done', `${reviewed.files.length} fichier(s)`);

    state.status = 'awaiting-approval';
    step('approval', 'running', 'en attente de ta validation');
    const approved = await this.waitApproval(signal);
    if (signal.aborted) throw new Error('Annulé.');
    if (!approved) {
      state.status = 'refused';
      state.finishedAt = Date.now();
      step('approval', 'failed', 'plan refusé : rien n’a été écrit');
      for (const id of TASK_STEPS.slice(3).map((s) => s.id)) step(id, 'skipped');
      return 'Plan refusé : rien n’a été écrit.';
    }
    state.approvedAt = Date.now();
    state.status = 'running';
    this.approval = approvalFromPlan(reviewed, state.branch);
    step('approval', 'done', 'validé');

    step('sandbox', 'running');
    const created = await this.call(
      'dev_create_branch',
      { branch: state.branch, folder: this.repo.folder },
      signal,
    );
    if (created.status !== 'ok' || !this.sandbox) throw new TaskStopped(created.content);
    state.worktreePath = this.sandbox.path;
    state.baseCommit = this.sandbox.baseCommit;
    step('sandbox', 'done', this.sandbox.path);

    step('install', 'running', 'ta confirmation (réseau : registre npm)');
    const installed = await this.call('dev_install_sandbox', {}, signal);
    if (installed.status !== 'ok')
      throw new TaskStopped(`Dépendances non installées : ${installed.content}`);
    step('install', 'done', 'npm ci --ignore-scripts');

    state.baseline = await this.testSeries('baseline', step, signal, pause);
    step('baseline', 'done', state.baseline.map((r) => `${r.suite} : ${r.summary}`).join(' · '));

    step('edit', 'running', 'le modèle modifie la copie isolée');
    const tools = this.modelTools(toolView(this.manager, TASK_MODEL_TOOLS), signal);
    const edit = await code.runTools({
      tools,
      system: editSystemPrompt(reviewed),
      prompt: editPrompt(state.request),
      maxRounds: 24,
      signal,
      requestConfirmation: (request) => this.decide(request, signal),
      beforeRound: pause,
    });
    if (edit.stoppedBy === 'error')
      throw new TaskStopped(`Le modèle de code a échoué : ${edit.error}`);
    await this.checkpoint('Modification (plan validé)', signal);
    if (state.diff.length === 0) {
      step('edit', 'failed', 'aucune modification');
      throw new TaskStopped(this.finish(step, 'stopped', 'Le modèle n’a rien modifié.'));
    }
    step('edit', 'done', `${state.diff.length} fichier(s) modifié(s)`);

    await this.scanGate(step, signal);
    let run = await this.testRun('Après modification', 'test', step, signal, pause);
    while (!run.ok && state.attempts < state.maxAttempts) {
      const n = (state.attempts += 1);
      addStep(`fix-${n}`, `Correction ${n}/${state.maxAttempts} : analyse des erreurs`, 'report');
      addStep(`retest-${n}`, `Tests après la correction ${n}`, 'report');
      step(`fix-${n}`, 'running', `${run.newFailures.length} échec(s) à corriger`);
      const fix = await code.runTools({
        tools,
        system: fixSystemPrompt(reviewed, n, state.maxAttempts),
        prompt: fixPrompt(
          run.newFailures,
          run.results.filter((r) => r.failures.length).map((r) => r.excerpt),
        ),
        maxRounds: 16,
        signal,
        requestConfirmation: (request) => this.decide(request, signal),
        beforeRound: pause,
      });
      if (fix.stoppedBy === 'error')
        throw new TaskStopped(`Le modèle de code a échoué : ${fix.error}`);
      await this.checkpoint(`Correction ${n}`, signal);
      step(
        `fix-${n}`,
        'done',
        fix.calls.length ? `${fix.calls.length} action(s)` : 'aucune action',
      );
      await this.scanGate(step, signal);
      run = await this.testRun(`Correction ${n}`, `retest-${n}`, step, signal, pause);
    }
    const message = this.finish(step, run.ok ? 'success' : 'failed');
    if (!run.ok) throw new TaskStopped(message);
    return message;
  }
}
