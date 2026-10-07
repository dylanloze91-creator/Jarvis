import {
  JARVIS_PROJECT_PROFILE,
  SAFETY_LABELS,
  classifyCommand,
  planCoverage,
  randomId,
  type CommandClassification,
  type CommandSafetyContext,
  type ConfirmationRequest,
  type CoverageRequest,
  type DiffFile,
  type OllamaCodeOptions,
  type PlanApproval,
  type ProjectProfile,
  type ProviderRegistry,
  type ReviewedPlan,
  type ScanFinding,
  type TaskPlan,
  type ToolCallOutcome,
  type ToolManager,
} from '@jarvis/core';
import type { ManualPassageView } from '@jarvis/core';
import type { CodeTaskState, DevStepStatus, DeveloperState } from '../../../shared/developerIpc.js';
import type { OllamaApi } from '../models/ollamaApi.js';
import type { Runner } from '../runner.js';
import type { ChatActivity } from './chatActivity.js';
import { previewWrite } from './preview.js';
import type { Sandbox } from './sandbox.js';
import type { NodeTools } from './suites.js';

export type StepFn = (id: string, status: DevStepStatus, detail?: string) => void;
export type AddStepFn = (id: string, label: string, beforeId?: string) => void;

/** Avancement de la boucle de modification, pour la vue de mission. */
export type TaskPhase = 'plan' | 'edit' | 'test' | 'review' | 'diagnose' | 'fix';
export type TaskPhaseStatus = 'running' | 'done' | 'failed';

/**
 * Points d'accroche d'une mission sur la tâche de code. Tous facultatifs :
 * sans eux, la tâche se déroule exactement comme avant.
 */
export interface TaskHooks {
  /** Contexte ajouté à la demande pour le plan (objectif, réponses, conception). */
  planContext?: string;
  /** Mission de documentation : un fichier non Markdown du plan n'est pas couvert par la validation. */
  docsOnly?: boolean;
  /** Plan de secours (projet neuf, 5.0.1) si le CODER ne rend pas de plan valide ; validé comme un autre. */
  fallbackPlan?: TaskPlan;
  /** Plan déjà validé (comparaison de modèles 5.0.4) : saute la génération. */
  presetPlan?: ReviewedPlan;
  /** Avec presetPlan : saute la carte de validation du plan (comparaison 2e passe). */
  autoApprovePlan?: boolean;
  /**
   * Discussion projet (5.0.6) : code seul, plan auto-validé, npm/tests dans la copie
   * isolée sans carte ; fusion dans le projet sans carte si succès. Carte seulement
   * pour push, publication, secrets, hors sandbox, admin, cœur Jarvis.
   */
  directRun?: boolean;
  /** Accord chat projet : moteur graphique (Godot, Unity…). */
  graphicsEngineGranted?: boolean;
  /**
   * Projet né d'un gabarit (5.0.1) : modification et corrections fichier par
   * fichier (contenu complet rendu par le modèle), avec ces fichiers en référence.
   */
  fileByFile?: { references: readonly string[]; guide?: string };
  /** REVIEWER, une fois les tests verts : des points bloquants comptent comme des échecs à corriger. */
  review?: (
    diff: string,
    signal: AbortSignal,
  ) => Promise<{ blocking: string[]; summary: string; model: string }>;
  /** DEBUGGER, avant chaque correction : diagnostic ajouté à la consigne ; `tools` lit la copie isolée. */
  diagnose?: (
    failures: string[],
    excerpts: string[],
    signal: AbortSignal,
    tools: Pick<ToolManager, 'schemas' | 'execute'>,
  ) => Promise<string>;
  /** Rafraîchit le manuel technique (ex. après de nouveaux échecs). */
  refreshManual?: (failures: string[]) => Promise<{ block: string; passages: ManualPassageView[] }>;
  onPhase?: (
    phase: TaskPhase,
    status: TaskPhaseStatus,
    detail?: string,
    extra?: { files?: string[]; tokPerSec?: number | null; rounds?: number },
  ) => void;
}

export interface AskExtra {
  safety: CommandClassification;
  reason: string;
  diff?: DiffFile[];
  findings?: ScanFinding[];
}

export interface TaskHost {
  ask(request: ConfirmationRequest, extra: AskExtra, signal?: AbortSignal): Promise<boolean>;
  emit(): DeveloperState;
  /** Journal d'audit ; `note` = « validé par le plan » quand aucun clic n'a été demandé. */
  audit(outcome: ToolCallOutcome, note?: string): void;
  log(line: string): void;
  node(): Promise<NodeTools | null>;
  /** Outils de lecture (dev_read_file…) dans la copie de l'utilisateur (ou celle du projet `root`), pour le plan. */
  readTools(root?: string): Pick<ToolManager, 'schemas' | 'execute'>;
}

export interface TaskDeps {
  registry: ProviderRegistry;
  run: Runner;
  ollama(): OllamaApi;
  chat: ChatActivity;
  modelOptions(model: string): OllamaCodeOptions;
  /** Fenêtre après un tour de chat avant de reprendre (question de suite à la voix). */
  graceMs?: number;
}

const FILE_TOOLS = new Set([
  'dev_create_file',
  'dev_edit_file',
  'dev_write_file',
  'dev_delete_file',
]);

/** Une exécution de tâche : état affiché, copie isolée, plan validé et règle de confirmation. */
export class TaskRunBase {
  sandbox: Sandbox | null = null;
  protected extraSafetyContext: Partial<CommandSafetyContext> = {};
  protected reviewed: ReviewedPlan | null = null;
  protected approval: PlanApproval | null = null;
  protected series = 0;
  protected readonly calls = new Map<string, { name: string; arguments: Record<string, unknown> }>();

  constructor(
    protected readonly host: TaskHost,
    protected readonly deps: TaskDeps,
    readonly state: CodeTaskState,
    protected readonly manager: ToolManager,
    /** Projet de la tâche : ses tests, ses fichiers protégés, son contexte. Jarvis par défaut. */
    readonly profile: ProjectProfile = JARVIS_PROJECT_PROFILE,
  ) {}

  protected async commandContext(): Promise<CommandSafetyContext> {
    const base = this.sandbox ? await this.sandbox.context() : {};
    return { ...base, ...this.extraSafetyContext };
  }

  protected coverageRequest(name: string, args: Record<string, unknown>): CoverageRequest {
    const path = String(args.path ?? '');
    switch (name) {
      case 'dev_create_file':
      case 'dev_edit_file':
      case 'dev_write_file':
        return { kind: 'write', path };
      case 'dev_delete_file':
        return { kind: 'delete', path };
      case 'dev_run_tests':
        return { kind: 'tests', suite: String(args.suite ?? ''), series: this.series };
      case 'dev_create_branch':
        return { kind: 'branch', branch: String(args.branch ?? '') };
      case 'dev_rollback':
        return { kind: 'rollback' };
      case 'dev_discard_sandbox':
        return { kind: 'discard' };
      case 'dev_install_sandbox':
        return { kind: 'install' };
      default:
        return { kind: 'other', toolName: name };
    }
  }

  /** Décision 9 : couvert par le plan → sans clic (noté au journal) ; sinon carte avec diff ou commande. */
  protected async decide(request: ConfirmationRequest, signal?: AbortSignal): Promise<boolean> {
    const call = this.calls.get(request.callId) ?? { name: request.toolName, arguments: {} };
    const coverage = planCoverage(
      this.approval,
      this.coverageRequest(call.name, call.arguments),
      this.profile.protectedFileReason,
    );
    if (coverage.covered && !request.forced) {
      this.state.planApproved.push({
        tool: call.name,
        target: String(call.arguments.path ?? call.arguments.suite ?? call.arguments.branch ?? ''),
        at: Date.now(),
      });
      return true;
    }
    this.state.asked += 1;
    const firstLine = (request.command ?? '').split('\n')[0] ?? '';
    let safety: CommandClassification;
    let diff: DiffFile[] | undefined;
    if (FILE_TOOLS.has(call.name)) {
      const level =
        call.name === 'dev_delete_file' || /cœur/.test(coverage.reason)
          ? 'always-confirm'
          : 'confirm';
      safety = {
        command: firstLine,
        level,
        label: SAFETY_LABELS[level],
        reasons: [coverage.reason],
        runsWithoutAsking: false,
      };
      diff = this.sandbox
        ? await previewWrite(this.sandbox.path, call.name, call.arguments)
        : undefined;
    } else {
      safety = classifyCommand(firstLine, await this.commandContext());
    }
    if (safety.level === 'denied') return false;
    return this.host.ask(request, { safety, reason: coverage.reason, diff }, signal);
  }

  /** Exécute un outil de la tâche avec la règle de confirmation, et l'inscrit au journal. */
  protected async call(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolCallOutcome> {
    return this.execute({ id: randomId(), name, arguments: args }, signal);
  }

  protected async execute(
    call: { id: string; name: string; arguments: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<ToolCallOutcome> {
    this.calls.set(call.id, { name: call.name, arguments: call.arguments });
    const before = this.state.planApproved.length;
    const outcome = await this.manager.execute(call, {
      signal,
      requestConfirmation: (request) => this.decide(request, signal),
      onProgress: (line) => this.host.log(line),
    });
    this.calls.delete(call.id);
    const covered = this.state.planApproved.length > before;
    this.host.audit(outcome, covered ? 'Validé par le plan' : undefined);
    this.host.emit();
    return outcome;
  }

  /** Vue des outils du modèle qui passe par la même règle de confirmation et le même journal. */
  protected modelTools(view: Pick<ToolManager, 'schemas' | 'execute'>, signal?: AbortSignal) {
    return {
      schemas: () => view.schemas(),
      execute: (call: { id: string; name: string; arguments: Record<string, unknown> }) =>
        view.schemas().some((schema) => schema.name === call.name)
          ? this.execute(call, signal)
          : view.execute(call, { requestConfirmation: async () => false, signal }),
    } as Pick<ToolManager, 'schemas' | 'execute'>;
  }

  /**
   * Décision 5 : appelé entre deux étapes (tour du modèle, série de tests).
   * Si un tour de chat est en cours, la tâche libère le modèle de code et
   * attend la fin du tour (et la fenêtre de suite) avant de reprendre.
   */
  protected async yieldToChat(
    signal: AbortSignal,
    addStep: AddStepFn,
    step: StepFn,
  ): Promise<void> {
    if (!this.deps.chat.busy) return;
    const pause = { startedAt: Date.now(), endedAt: null as number | null };
    this.state.pauses.push(pause);
    const id = `pause-${this.state.pauses.length}`;
    addStep(id, 'Pause : la discussion a la priorité', 'report');
    const previous = this.state.status;
    this.state.status = 'paused';
    step(id, 'running', 'modèle de code libéré pour le chat');
    await this.deps.ollama().unload(this.state.model);
    try {
      await this.deps.chat.whenIdle(this.deps.graceMs ?? 3_000, signal);
    } finally {
      pause.endedAt = Date.now();
      this.state.status = previous === 'paused' ? 'running' : previous;
    }
    step(id, 'done', `reprise après ${Math.round((pause.endedAt - pause.startedAt) / 1000)} s`);
  }
}
