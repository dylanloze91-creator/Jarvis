import {
  CodeModelFormatError,
  SCAN_LABELS,
  approvalFromPlan,
  compareRuns,
  createCodeAIProvider,
  editPrompt,
  editSystemPrompt,
  findingKey,
  fixPrompt,
  fixSystemPrompt,
  maxTestSeriesFor,
  parsePlanReply,
  parseUnifiedDiff,
  tokensPerSecond,
  planPrompt,
  planSystemPrompt,
  randomId,
  reviewPlan,
  scanDiff,
  suiteCommandFor,
  extractFileContent,
  fileWritePrompt,
  fileWriteSystem,
  addUsage,
  type ChatUsage,
  STEP_LIMITS,
  limitText,
  retryLimit,
  withDeadline,
  type StepLimit,
  type ToolLoopInput,
  normalizeRepoRelative,
  toolView,
  trimDiffFiles,
  type CodeAIProvider,
  type ProjectProfile,
  type TaskPlan,
  type TestRunSummary,
  type ToolManager,
} from '@jarvis/core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodeTaskRun, CodeTaskState } from '../../../shared/developerIpc.js';
import { PROJECT_MODEL_TOOLS, TASK_MODEL_TOOLS } from '../tools/taskTools.js';
import { patientFetch } from '../models/patientFetch.js';
import { buildTaskReport } from './report.js';
import { SANDBOX_NPM_CI_ARGS } from './suites.js';
import {
  TaskRunBase,
  type AddStepFn,
  type StepFn,
  type TaskDeps,
  type TaskHooks,
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

function speed(usage: { outputTokens: number; outputMs: number }): number | null {
  return usage.outputMs > 0
    ? Math.round(tokensPerSecond(usage.outputTokens, usage.outputMs) * 10) / 10
    : null;
}

const WRITE_TOOLS = new Set(['dev_create_file', 'dev_edit_file', 'dev_write_file']);

/** Échecs d'une série de tests, sans ordre : deux séries au même ensemble ont la même signature. */
export function failureSignature(failures: readonly string[]): string {
  return [...new Set(failures)].sort().join('\n');
}

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
    private readonly hooks: TaskHooks = {},
    profile?: ProjectProfile,
  ) {
    super(host, deps, state, manager, profile);
  }

  /** Copie de l'utilisateur d'où part la tâche (Jarvis ou le projet). */
  get repoRoot(): string {
    return this.repo.root;
  }

  get tasksRoot(): string {
    return this.repo.worktreeRoot;
  }

  private manualText(): string | undefined {
    return this.state.manualBlock?.trim() || undefined;
  }

  private planRequest(): string {
    const prompt = planPrompt(this.state.request);
    return this.hooks.planContext ? `${prompt}\n\n${this.hooks.planContext}` : prompt;
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

  /** Un tour du modèle de code sous plafond (jetons par réponse, durée) ; `expired` : délai atteint. */
  private async limitedRun(
    code: CodeAIProvider,
    input: Omit<Parameters<CodeAIProvider['runTools']>[0], 'signal' | 'maxTokens'>,
    limit: StepLimit,
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<CodeAIProvider['runTools']>> & { expired: boolean }> {
    const deadline = withDeadline(signal, limit.timeoutMs);
    try {
      const result = await code.runTools({
        ...input,
        maxTokens: limit.maxTokens,
        signal: deadline.signal,
      });
      return { ...result, expired: deadline.expired() };
    } finally {
      deadline.dispose();
    }
  }

  private async makePlan(
    code: CodeAIProvider,
    signal: AbortSignal,
    pause: () => Promise<void>,
  ): Promise<TaskPlan> {
    const tools = this.host.readTools(this.repo.root);
    const first = await this.limitedRun(
      code,
      {
        tools,
        system: planSystemPrompt(this.profile, this.manualText()),
        prompt: this.planRequest(),
        maxRounds: 10,
        beforeRound: pause,
      },
      STEP_LIMITS.plan,
      signal,
    );
    if (signal.aborted) throw new Error('Annulé.');
    if (first.stoppedBy === 'error' && !first.expired)
      throw new Error(`Le modèle de code n’a pas répondu : ${first.error}`);
    let problem = first.expired ? `délai dépassé (${limitText(STEP_LIMITS.plan)})` : '';
    if (!first.expired) {
      try {
        return parsePlanReply(first.finalText, this.profile);
      } catch (error) {
        if (!(error instanceof CodeModelFormatError)) throw error;
        problem = error.message;
      }
    }
    const read = first.calls
      .filter((c) => c.status === 'ok')
      .map((c) => `${c.name} ${JSON.stringify(c.arguments)}`)
      .slice(0, 12)
      .join('\n');
    const retry = await this.limitedRun(
      code,
      {
        tools: toolView(tools, []),
        system: planSystemPrompt(this.profile, this.manualText()),
        prompt: `${this.planRequest()}\n\nDéjà consulté :\n${read || '—'}\n\nTa réponse précédente n’était pas un plan valide (${problem}). Réponds seulement par le bloc JSON du plan, court.`,
        maxRounds: 1,
        beforeRound: pause,
      },
      retryLimit(STEP_LIMITS.plan),
      signal,
    );
    if (signal.aborted) throw new Error('Annulé.');
    if (retry.stoppedBy === 'error' && !retry.expired && !this.hooks.fallbackPlan)
      throw new Error(`Le modèle de code n’a pas répondu : ${retry.error}`);
    try {
      if (retry.stoppedBy !== 'error') return parsePlanReply(retry.finalText, this.profile);
      problem = retry.expired ? `délai dépassé` : (retry.error ?? 'erreur du modèle');
    } catch (error) {
      if (!(error instanceof CodeModelFormatError) || !this.hooks.fallbackPlan) throw error;
      problem = error.message;
    }
    if (!this.hooks.fallbackPlan) throw new Error(`Plan impossible : ${problem}`);
    this.state.planFallback = `plan de secours (gabarit du projet) : le modèle n’a pas rendu de plan valide (${problem.slice(0, 160)})`;
    return this.hooks.fallbackPlan;
  }

  /**
   * Projets (5.0.1) : un petit modèle annonce souvent « je vais écrire… » sans
   * appeler d'outil. Relance (3 fois au plus) en nommant le fichier du plan à
   * écrire. Absent pour Jarvis : son déroulé ne change pas.
   */
  private writeNudge(kind: 'edit' | 'fix'): ToolLoopInput['nudge'] {
    if (!this.profile.editHints) return undefined;
    let left = 3;
    const planned = (this.reviewed?.files ?? []).filter(
      (f) => f.action !== 'delete' && !f.problem && !f.core,
    );
    return (_answer, calls) => {
      if (left <= 0) return null;
      const written = new Set(
        calls
          .filter((c) => c.status === 'ok' && WRITE_TOOLS.has(c.name))
          .map((c) => (normalizeRepoRelative(String(c.arguments.path ?? '')) ?? '').toLowerCase()),
      );
      if (kind === 'fix') {
        if (written.size > 0) return null;
        left -= 1;
        return 'Tu n’as encore rien corrigé. Corrige maintenant le fichier en cause : appelle dev_write_file avec son contenu complet corrigé, sans explication.';
      }
      const next = planned.find((f) => !written.has(f.path.toLowerCase()));
      if (!next) return null;
      left -= 1;
      const tool = next.exists ? 'dev_write_file' : 'dev_create_file';
      return `Tu n’as pas encore écrit ${next.path}. Écris-le maintenant : appelle ${tool} avec path "${next.path}" et le contenu complet du fichier, sans explication.`;
    };
  }

  /**
   * Projets (5.0.1) : un échec d'outil du modèle porte un conseil (réécrire le
   * fichier entier), et un appel qui échoue à l'identique est signalé, au lieu
   * de tourner en rond jusqu'au plafond de tours.
   */
  private coached(
    tools: Pick<ToolManager, 'schemas' | 'execute'>,
  ): Pick<ToolManager, 'schemas' | 'execute'> {
    if (!this.profile.editHints) return tools;
    const failures = new Map<string, number>();
    return {
      schemas: () => tools.schemas(),
      execute: async (call, context, events) => {
        const outcome = await tools.execute(call, context, events);
        if (outcome.status === 'ok') return outcome;
        const key = `${call.name}|${JSON.stringify(call.arguments)}`;
        const count = (failures.get(key) ?? 0) + 1;
        failures.set(key, count);
        const path = String(call.arguments.path ?? 'le fichier');
        const hints: string[] = [];
        if (call.name === 'dev_edit_file' || /existe déjà/.test(outcome.content))
          hints.push(
            `Pour changer ${path}, réécris-le en entier : dev_write_file avec path "${path}" et le contenu complet.`,
          );
        if (count >= 2) hints.push('Cet appel a déjà échoué de la même façon : change d’approche.');
        return hints.length
          ? { ...outcome, content: `${outcome.content}\n${hints.join(' ')}` }
          : outcome;
      },
    };
  }

  private async readSandbox(path: string): Promise<string | null> {
    try {
      return await readFile(join(this.sandbox!.path, path), 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Écriture fichier par fichier (projets nés d'un gabarit, 5.0.1) : un appel
   * du modèle par fichier du plan (hors fichiers protégés), contenu complet,
   * écrit par l'outil de la tâche, donc couvert par le plan et inscrit au journal.
   */
  private async writeFiles(
    code: CodeAIProvider,
    mode: 'edit' | 'fix',
    signal: AbortSignal,
    pause: () => Promise<void>,
    failure?: { failures: string[]; excerpts: string[]; diagnosis: string },
  ): Promise<{ written: string[]; usage: ChatUsage; expired: boolean }> {
    const limit = mode === 'edit' ? STEP_LIMITS.edit : STEP_LIMITS.fix;
    const deadline = withDeadline(signal, limit.timeoutMs);
    const planned = this.reviewed!.files.filter(
      (f) => f.action !== 'delete' && !f.problem && !f.core,
    );
    let targets = planned;
    if (failure) {
      const named = planned.filter((f) => failure.failures.some((x) => x.includes(f.path)));
      if (named.length) targets = named;
    }
    const isTest = (path: string) => /\.(test|spec)\.|Tests?\.cs$/.test(path);
    targets = [...targets].sort((a, b) => Number(isTest(a.path)) - Number(isTest(b.path)));
    const fixedFiles = failure
      ? [
          ...new Set(
            failure.failures.flatMap((x) =>
              [...x.matchAll(/[\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?/g)].map((m) => m[0]),
            ),
          ),
        ].filter((path) => this.profile.protectedFileReason(path) !== null)
      : [];
    const written: string[] = [];
    let usage: ChatUsage = {
      promptTokens: 0,
      promptMs: 0,
      outputTokens: 0,
      outputMs: 0,
      loadMs: 0,
      totalMs: 0,
    };
    try {
      for (const file of targets) {
        if (deadline.signal.aborted) break;
        await pause();
        const current = await this.readSandbox(file.path);
        const related: Array<{ path: string; content: string }> = [];
        for (const path of [
          ...(this.hooks.fileByFile?.references ?? []),
          ...fixedFiles,
          ...planned.map((f) => f.path),
        ]) {
          if (path === file.path || related.some((r) => r.path === path)) continue;
          const content = await this.readSandbox(path);
          if (content !== null) related.push({ path, content });
        }
        this.host.log(`Écriture de ${file.path}…`);
        let text: string;
        try {
          const reply = await code.complete({
            system: fileWriteSystem(this.reviewed!, this.profile, this.manualText()),
            prompt: fileWritePrompt({
              request: this.state.request,
              path: file.path,
              current,
              context: this.hooks.fileByFile?.guide ?? this.hooks.planContext,
              related,
              ...(failure ?? {}),
              ...(fixedFiles.length ? { fixedFiles } : {}),
            }),
            maxTokens: limit.maxTokens,
            signal: deadline.signal,
          });
          text = reply.text;
          usage = addUsage(usage, reply.usage);
        } catch (error) {
          if (signal.aborted) throw error;
          if (deadline.expired()) break;
          throw new TaskStopped(
            `Le modèle de code a échoué : ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const content = extractFileContent(text);
        if (!content) {
          this.host.log(`${file.path} : la réponse ne contient pas de code.`);
          continue;
        }
        const outcome = await this.call(
          current === null ? 'dev_create_file' : 'dev_write_file',
          { path: file.path, content },
          signal,
        );
        if (outcome.status === 'ok') written.push(file.path);
      }
    } finally {
      deadline.dispose();
    }
    if (deadline.expired())
      this.host.log(
        `${mode === 'edit' ? 'Modification' : 'Correction'} : délai atteint (${limitText(limit)}).`,
      );
    return { written, usage, expired: deadline.expired() };
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
    this.hooks.onPhase?.(
      'test',
      'running',
      this.reviewed!.tests.map((s) => suiteCommandFor(this.profile, s)).join(' · '),
    );
    for (const suite of this.reviewed!.tests) {
      await pause();
      step(stepId, 'running', `${suiteCommandFor(this.profile, suite)}…`);
      const outcome = await this.call('dev_run_tests', { suite }, signal);
      if (outcome.status !== 'ok') {
        this.hooks.onPhase?.('test', 'failed', outcome.content.split('\n')[0]);
        throw new TaskStopped(outcome.content);
      }
      results.push(outcome.data as TestRunSummary);
    }
    const failing = results.reduce((n, r) => n + r.failures.length, 0);
    this.hooks.onPhase?.(
      'test',
      'done',
      `${results.map((r) => `${r.suite} : ${r.summary}`).join(' · ')}${failing ? ` (${failing} échec(s) au total)` : ''}`,
    );
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

  /** REVIEWER d'une mission, une fois les tests verts : un point bloquant compte comme un échec. */
  private async reviewGate(run: CodeTaskRun, signal: AbortSignal): Promise<CodeTaskRun> {
    if (!run.ok || !this.hooks.review) return run;
    this.hooks.onPhase?.('review', 'running', 'revue du diff testé');
    const result = await this.hooks.review(await this.sandbox!.diff(signal), signal);
    this.state.review = { ...result, at: Date.now() };
    if (result.blocking.length === 0) {
      this.hooks.onPhase?.('review', 'done', result.summary);
      return run;
    }
    this.hooks.onPhase?.('review', 'failed', `${result.blocking.length} point(s) bloquant(s)`);
    run.ok = false;
    run.newFailures = result.blocking.map((issue) => `revue : ${issue}`);
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
    if (verdict === 'failed' && reason)
      return `${reason} Vois le rapport. Ta copie de travail n’a pas été touchée.`;
    if (verdict === 'failed')
      return `Des tests échouent encore après ${this.state.attempts} correction(s) : vois le rapport. Ta copie de travail n’a pas été touchée.`;
    return `Tâche arrêtée${reason ? ` : ${reason}` : ''}.`;
  }

  /** Déroulé complet. Toute écriture a lieu dans la copie isolée ; la copie de l'utilisateur n'est pas modifiée. */
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
      fetch: patientFetch,
    });
    const pause = () => this.yieldToChat(signal, addStep, step);
    step('model', 'done', state.model);

    step('plan', 'running', 'lecture du dépôt');
    this.hooks.onPhase?.('plan', 'running', 'lecture du dépôt, plan de modification');
    const plan = await this.makePlan(code, signal, pause);
    const review = (p: TaskPlan) =>
      reviewPlan(p, (path) => this.repo.tracked.has(path), this.profile.protectedFileReason);
    let checked = review(plan);
    const entry = this.hooks.fallbackPlan;
    if (
      entry &&
      plan !== entry &&
      !checked.files.some((f) => !f.problem && entry.files.some((e) => e.path === f.path))
    ) {
      state.planFallback = `plan de secours (gabarit du projet) : le plan du modèle ne touchait aucun fichier d’entrée du gabarit (${entry.files.map((f) => f.path).join(', ')})`;
      checked = review(entry);
    }
    this.reviewed = this.hooks.docsOnly
      ? {
          ...checked,
          files: checked.files.map((f) =>
            /\.md$/i.test(f.path) || f.problem
              ? f
              : {
                  ...f,
                  problem: 'mission de documentation : seulement des fichiers Markdown (.md)',
                },
          ),
        }
      : checked;
    const reviewed = this.reviewed;
    this.hooks.onPhase?.('plan', 'done', reviewed.summary, {
      files: reviewed.files.map((f) => f.path),
    });
    state.plan = {
      summary: reviewed.summary,
      criteria: reviewed.criteria,
      files: reviewed.files,
      tests: reviewed.tests,
      testCommands: reviewed.tests.map((s) => suiteCommandFor(this.profile, s)),
      maxTestSeries: maxTestSeriesFor(state.maxAttempts),
      dirtyFiles: reviewed.files.map((f) => f.path).filter((p) => this.repo.dirty.has(p)),
      branchCommand: `git worktree add -b ${state.branch} "${join(this.repo.worktreeRoot, this.repo.folder)}" HEAD`,
      installCommand: this.profile.install
        ? `dotnet ${this.profile.install.args.join(' ')}`
        : `npm ${SANDBOX_NPM_CI_ARGS.join(' ')}`,
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
    this.approval = approvalFromPlan(reviewed, state.branch, state.maxAttempts);
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

    step(
      'install',
      'running',
      this.profile.install
        ? 'ta confirmation (réseau : NuGet)'
        : 'ta confirmation (réseau : registre npm)',
    );
    const installed = await this.call('dev_install_sandbox', {}, signal);
    if (installed.status !== 'ok')
      throw new TaskStopped(`Dépendances non installées : ${installed.content}`);
    step(
      'install',
      'done',
      this.profile.install ? state.plan!.installCommand : 'npm ci --ignore-scripts',
    );

    state.baseline = await this.testSeries('baseline', step, signal, pause);
    step('baseline', 'done', state.baseline.map((r) => `${r.suite} : ${r.summary}`).join(' · '));

    step('edit', 'running', 'le modèle modifie la copie isolée');
    this.hooks.onPhase?.('edit', 'running', 'modification dans la copie isolée');
    const tools = this.coached(
      this.modelTools(
        toolView(this.manager, this.profile.editHints ? PROJECT_MODEL_TOOLS : TASK_MODEL_TOOLS),
        signal,
      ),
    );
    const byFile = this.hooks.fileByFile
      ? await this.writeFiles(code, 'edit', signal, pause)
      : null;
    const edit = byFile
      ? {
          stoppedBy: 'answer' as const,
          expired: byFile.expired,
          error: null,
          usage: byFile.usage,
          rounds: byFile.written.length,
        }
      : await this.limitedRun(
          code,
          {
            tools,
            system: editSystemPrompt(reviewed, this.profile, this.manualText()),
            prompt: editPrompt(state.request),
            maxRounds: 24,
            requestConfirmation: (request) => this.decide(request, signal),
            beforeRound: pause,
            nudge: this.writeNudge('edit'),
          },
          STEP_LIMITS.edit,
          signal,
        );
    if (signal.aborted) throw new Error('Annulé.');
    if (edit.stoppedBy === 'error' && !edit.expired)
      throw new TaskStopped(`Le modèle de code a échoué : ${edit.error}`);
    if (edit.expired)
      this.host.log(
        `Modification : délai atteint (${limitText(STEP_LIMITS.edit)}), on teste ce qui est écrit.`,
      );
    await this.checkpoint('Modification (plan validé)', signal);
    if (state.diff.length === 0) {
      step('edit', 'failed', 'aucune modification');
      this.hooks.onPhase?.('edit', 'failed', 'aucune modification');
      throw new TaskStopped(this.finish(step, 'stopped', 'Le modèle n’a rien modifié.'));
    }
    step('edit', 'done', `${state.diff.length} fichier(s) modifié(s)`);
    this.hooks.onPhase?.('edit', 'done', `${state.diff.length} fichier(s) modifié(s)`, {
      files: state.diff.map((f) => f.path),
      tokPerSec: speed(edit.usage),
      rounds: edit.rounds,
    });

    await this.scanGate(step, signal);
    let run = await this.reviewGate(
      await this.testRun('Après modification', 'test', step, signal, pause),
      signal,
    );
    let previous = failureSignature(run.newFailures);
    while (!run.ok && state.attempts < state.maxAttempts) {
      const n = (state.attempts += 1);
      addStep(`fix-${n}`, `Correction ${n}/${state.maxAttempts} : analyse des erreurs`, 'report');
      addStep(`retest-${n}`, `Tests après la correction ${n}`, 'report');
      step(`fix-${n}`, 'running', `${run.newFailures.length} échec(s) à corriger`);
      const excerpts = run.results.filter((r) => r.failures.length).map((r) => r.excerpt);
      if (this.hooks.refreshManual) {
        await this.hooks.refreshManual(run.newFailures);
      }
      let diagnosis = '';
      if (this.hooks.diagnose) {
        this.hooks.onPhase?.('diagnose', 'running', `${run.newFailures.length} échec(s)`);
        try {
          diagnosis = await this.hooks.diagnose(
            run.newFailures,
            excerpts,
            signal,
            this.modelTools(
              toolView(this.manager, ['dev_read_file', 'dev_search_code', 'dev_search_files']),
              signal,
            ),
          );
          this.hooks.onPhase?.('diagnose', 'done', diagnosis.split('\n')[0]);
        } catch (error) {
          if (signal.aborted) throw error;
          this.hooks.onPhase?.(
            'diagnose',
            'failed',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      this.hooks.onPhase?.('fix', 'running', `correction ${n} sur ${state.maxAttempts}`);
      const fixByFile = this.hooks.fileByFile
        ? await this.writeFiles(code, 'fix', signal, pause, {
            failures: run.newFailures,
            excerpts,
            diagnosis,
          })
        : null;
      const fix = fixByFile
        ? {
            stoppedBy: 'answer' as const,
            expired: fixByFile.expired,
            error: null,
            usage: fixByFile.usage,
            rounds: fixByFile.written.length,
            calls: fixByFile.written.map((path) => ({
              name: 'dev_write_file',
              arguments: { path },
            })),
          }
        : await this.limitedRun(
            code,
            {
              tools,
              system: fixSystemPrompt(reviewed, n, state.maxAttempts, this.profile, this.manualText()),
              prompt: `${fixPrompt(run.newFailures, excerpts, this.manualText())}${diagnosis ? `\n\nDiagnostic du débogueur :\n${diagnosis}` : ''}`,
              maxRounds: 16,
              requestConfirmation: (request) => this.decide(request, signal),
              beforeRound: pause,
              nudge: this.writeNudge('fix'),
            },
            STEP_LIMITS.fix,
            signal,
          );
      if (signal.aborted) throw new Error('Annulé.');
      if (fix.stoppedBy === 'error' && !fix.expired) {
        this.hooks.onPhase?.('fix', 'failed', fix.error ?? 'erreur du modèle');
        throw new TaskStopped(`Le modèle de code a échoué : ${fix.error}`);
      }
      await this.checkpoint(`Correction ${n}`, signal);
      this.hooks.onPhase?.('fix', 'done', `${fix.calls.length} action(s)`, {
        files: state.diff.map((f) => f.path),
        tokPerSec: speed(fix.usage),
        rounds: fix.rounds,
      });
      step(
        `fix-${n}`,
        'done',
        fix.calls.length ? `${fix.calls.length} action(s)` : 'aucune action',
      );
      await this.scanGate(step, signal);
      run = await this.reviewGate(
        await this.testRun(`Correction ${n}`, `retest-${n}`, step, signal, pause),
        signal,
      );
      const current = failureSignature(run.newFailures);
      if (!run.ok && current === previous && n < state.maxAttempts) {
        state.repeatedFailure = {
          attempt: n,
          failures: run.newFailures.slice(0, 20),
          unused: state.maxAttempts - n,
        };
        this.hooks.onPhase?.('fix', 'failed', 'même échec qu’avant la correction : arrêt');
        const reason = `Arrêt net : la correction ${n} reproduit exactement le même échec que la série précédente (${run.newFailures.length} échec(s) identique(s) : ${run.newFailures.slice(0, 2).join(' ; ')}). ${state.repeatedFailure.unused ? `Les ${state.repeatedFailure.unused} correction(s) restante(s) ne sont pas tentées : le modèle tourne en rond.` : 'Le modèle tourne en rond.'}`;
        throw new TaskStopped(this.finish(step, 'failed', reason));
      }
      previous = current;
    }
    const message = this.finish(step, run.ok ? 'success' : 'failed');
    if (!run.ok) throw new TaskStopped(message);
    return message;
  }
}
