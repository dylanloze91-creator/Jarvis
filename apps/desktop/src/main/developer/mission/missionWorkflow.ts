import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  JARVIS_PROJECT_ID,
  JARVIS_PROJECT_PROFILE,
  LOOP_ACTORS,
  NEW_PROJECT_SCOPE,
  PROJECT_TEMPLATES,
  MISSION_LABELS,
  MAX_GOAL_QUESTIONS,
  ROLE_LABELS,
  architectSchema,
  briefBlock,
  createCodeAIProvider,
  createMission,
  debuggerSchema,
  designContext,
  designPrompt,
  designSystem,
  diagnosePrompt,
  diagnoseSystem,
  diagnosisText,
  documentationSchema,
  factoryPrompt,
  factorySchema,
  factorySystem,
  computeMetrics,
  improvePrompt,
  improveSchema,
  improveSystem,
  metricIds,
  proposalMissionKind,
  proposalRequest,
  researchSystem,
  researcherSchema,
  skillPrompt,
  skillSchema,
  skillSystem,
  skillTaskContext,
  verifyProposals,
  SKILL_TEMPLATE_ID,
  STEP_LIMITS,
  SpecialistError,
  TEMPLATE_GUIDES,
  TEMPLATE_REFERENCES,
  dotnetDesktopTemplateReferences,
  DESKTOP_WINDOWS_EXE,
  isDotnetWindowsDesktopTemplate,
  developerAgentFailed,
  developerAgentFinished,
  developerAgentStarted,
  developerMissionFailureLine,
  summarizeRepoTree,
  fallbackFactory,
  fallbackGoal,
  fallbackSkill,
  steerFactory,
  webResearchChatLine,
  webResearchQueryForRequest,
  templatePlan,
  type FactoryOutput,
  type GoalOutput,
  type ResearcherOutput,
  type SkillDesign,
  goalPrompt,
  goalSchema,
  goalSystem,
  NEW_PROJECT_CONTEXT,
  memoryBlock,
  patchStep,
  randomId,
  resolveRoleModel,
  buildMissionModelPlan,
  modelRunCategory,
  type RoleModelRoute,
  type ModelRunRecord,
  GATED_MISSION_KINDS,
  assessMission,
  formatProjectDecisions,
  modelCapability,
  type MissionGate,
  type RealBenchResult,
  reviewPrompt,
  reviewSystem,
  reviewerSchema,
  structureReviewerOutput,
  runSpecialist,
  tokensPerSecond,
  upsertStep,
  type AuditScope,
  type ChatUsage,
  type MissionBrief,
  type MissionKind,
  type MissionState,
  type MissionStep,
  type MissionSummary,
  type OllamaCodeOptions,
  type ProviderRegistry,
  type Settings,
  type SpecialistCall,
  type SpecialistRole,
  type SpecialistRun,
  type ToolManager,
  type ArchitectOutput,
  type DebuggerOutput,
  type DocumentationOutput,
  type ProjectProfile,
  type ProjectTemplateId,
  parseNvidiaSmi,
  fallbackSupervisorPlan,
  supervisorPlanSchema,
  supervisorPrompt,
  supervisorSystem,
  type MissionAgentState,
  type MissionAgentStatus,
  type SupervisorAgentRole,
  type SupervisorPlan,
} from '@jarvis/core';
import type {
  CodeTaskState,
  DevStepStatus,
  DevTaskKind,
  DeveloperState,
} from '../../../shared/developerIpc.js';
import { repoReader, runAsk } from '../ask/askFlow.js';
import { gatherCodeFiles } from '../improve/measure.js';
import { readGpuMemory } from '../models/hardwareProbe.js';
import { patientFetch } from '../models/patientFetch.js';
import type { OllamaApi } from '../models/ollamaApi.js';
import type { Runner } from '../runner.js';
import type { ResolvedProject } from '../project/projectsWorkflow.js';
import type { TaskHooks, TaskPhase } from '../task/taskRun.js';
import type { TaskProject } from '../task/workflow.js';
import type { DeveloperManualStore } from '../knowledge/manualStore.js';
import type { MissionStore } from './history.js';

type Step = (id: string, status: DevStepStatus, detail?: string) => void;

export interface MissionStartExtras {
  discussionContext?: string;
  coderOverride?: { model: string; reason: string };
  projectDecisions?: string[];
}

export interface MissionHost {
  runTask(
    kind: DevTaskKind,
    title: string,
    steps: ReadonlyArray<{ id: string; label: string }>,
    work: (step: Step, signal: AbortSignal) => Promise<string>,
  ): Promise<DeveloperState>;
  emit(): DeveloperState;
  notice(message: string): DeveloperState;
  /** Outils de lecture de la copie (ou de celle du projet `root`), inscrits au journal. */
  readTools(root?: string): Pick<ToolManager, 'schemas' | 'execute'>;
  pause(model: string, signal: AbortSignal): Promise<void>;
  /** Boucle de modification existante (plan → validation → copie isolée → tests → corrections). */
  startTask(
    request: string,
    options: {
      model: string;
      hooks: TaskHooks;
      project?: TaskProject;
      templateId?: ProjectTemplateId;
    },
  ): Promise<DeveloperState>;
  currentTask(): CodeTaskState | null;
  /**
   * Après une mission « nouveau projet » bureau (.exe) réussie : appliquer la tâche
   * puis lancer « Construire » (dotnet publish win-x64) dans le projet.
   */
  deliverWindowsExe?(projectId: string): Promise<DeveloperState>;
  deliverDesktopShortcut?(
    project: ResolvedProject,
    request: string,
  ): Promise<string | null>;
  /** Fusionne la copie isolée dans le dossier projet (5.0.30). */
  applyTaskToProject?(): Promise<DeveloperState>;
}

/** Projets (0.5.3) : copie et profil d'un projet, sa mémoire, la Project Factory. */
export interface MissionProjects {
  resolve(id: string): Promise<ResolvedProject | string>;
  memoryNotes(id: string): Promise<string>;
  create(
    input: {
      template: ProjectTemplateId;
      name: string;
      description: string;
      skillTools?: Array<{ name: string; description: string }>;
    },
    step: Step,
    signal: AbortSignal,
    options?: { reuseEntryId?: string; trustedMissionCreate?: boolean },
  ): Promise<ResolvedProject | null>;
  scaffoldMissionFolder(
    request: string,
    reuseEntryId?: string,
  ): Promise<{ projectId: string; path: string; alreadyThere?: boolean } | string>;
}

export interface MissionDeps {
  registry: ProviderRegistry;
  ollama(): OllamaApi;
  run: Runner;
  settings(): Settings;
  modelOptions(model: string): OllamaCodeOptions;
  store: MissionStore;
  projects: MissionProjects;
  now?(): number;
  /** Résultats du banc réel (5.0.1) : le score Codeur règle le contrôle de difficulté. */
  realBenches?(): readonly RealBenchResult[];
  manualStore?: DeveloperManualStore;
  log?: (line: string) => void;
  modelRuns?(): Promise<readonly ModelRunRecord[]>;
  recordModelRun?: (record: Omit<ModelRunRecord, 'at'>) => Promise<void>;
  onMissionChatLine?: (line: string) => void;
  onMissionFocusProject?: (projectId: string) => void;
  webResearch?: (
    query: string,
    request: string,
  ) => Promise<{ chatLine: string; coderBlock: string } | null>;
  verifyWebGameRuntime?: (projectRoot: string) => Promise<{ ok: boolean; detail: string }>;
}

export const MISSION_PROJECT_ID = JARVIS_PROJECT_PROFILE.id;

function createsProject(kind: MissionKind): boolean {
  return kind === 'new-project' || kind === 'skill';
}

function speed(usage: ChatUsage): number | null {
  return usage.outputMs > 0
    ? Math.round(tokensPerSecond(usage.outputTokens, usage.outputMs) * 10) / 10
    : null;
}

const PHASE_LABELS: Record<TaskPhase, string> = {
  plan: 'Plan de modification',
  edit: 'Modification dans la copie isolée',
  test: 'Série de tests (liste fixe, sans modèle)',
  review: 'Revue du diff testé',
  diagnose: 'Diagnostic des échecs',
  fix: 'Correction',
};

/**
 * Missions sur Jarvis ou sur un projet : objectif et questions (REASONER),
 * conception (ARCHITECT, DEBUGGER ou DOCUMENTATION) ou création du projet,
 * puis la boucle de modification existante, avec REVIEWER et DEBUGGER
 * branchés dessus. Le routeur est fait de règles fixes ; chaque rôle prend
 * le modèle choisi par l'utilisateur.
 */
export class MissionWorkflow {
  private current: MissionState | null = null;
  /** Dernier contrôle de difficulté (5.0.1). */
  private gate: MissionGate | null = null;
  private history: MissionSummary[] | null = null;
  private historyProject: string = MISSION_PROJECT_ID;
  /** Projet de la mission en cours (null pour « Nouveau projet » avant sa création). */
  private project: ResolvedProject | null = null;
  private memory = '';
  private lastModel: string | null = null;
  private modelPlan: Map<SpecialistRole, RoleModelRoute> | null = null;
  private activeRole: SpecialistRole | null = null;
  private counters = new Map<TaskPhase, number>();
  private open = new Map<TaskPhase, string>();

  constructor(
    private readonly host: MissionHost,
    private readonly deps: MissionDeps,
  ) {}

  private get now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  view(): Pick<DeveloperState, 'mission' | 'missions' | 'missionsProject' | 'missionGate'> {
    return {
      mission: this.current,
      missions: this.history,
      missionsProject: this.historyProject,
      missionGate: this.gate && !this.gate.ok ? this.gate : null,
    };
  }

  private get profile(): ProjectProfile {
    return this.project?.profile ?? JARVIS_PROJECT_PROFILE;
  }

  /** Rattachement des entrées du journal à la mission en cours. */
  scope(): AuditScope | undefined {
    const mission = this.current;
    if (!mission || (mission.status !== 'running' && mission.status !== 'task')) return undefined;
    return {
      projectId: mission.projectId,
      missionId: mission.id,
      ...(this.activeRole ? { role: this.activeRole } : {}),
    };
  }

  private developer() {
    return this.deps.settings().developer;
  }

  private modelFor(role: SpecialistRole): string {
    if (role === 'CODER' && this.current?.coderOverride?.model)
      return this.current.coderOverride.model;
    const routed = this.modelPlan?.get(role);
    if (routed) return routed.model;
    return resolveRoleModel(role, this.developer())!;
  }

  private async repoMapOutline(root: string): Promise<string> {
    const listed = await this.deps.run({
      program: 'git',
      args: ['ls-files'],
      cwd: root,
      display: 'git ls-files',
      timeoutMs: 30_000,
      maxBytes: 400_000,
    });
    if (listed.code !== 0) return '';
    const paths = listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return summarizeRepoTree(paths);
  }

  private enrichedPlanContext(base: string): string {
    const mission = this.current;
    const parts = [base];
    if (mission?.discussionContext?.trim()) parts.push(mission.discussionContext.trim());
    if (mission?.projectDecisions?.length)
      parts.push(
        `Décisions mémorisées du projet :\n${formatProjectDecisions(mission.projectDecisions)}`,
      );
    return parts.join('\n\n');
  }

  private async persist(): Promise<void> {
    if (!this.current) return;
    this.current.updatedAt = this.now;
    await this.deps.store.save(this.current);
    this.historyProject = this.current.projectId;
    this.history = await this.deps.store.list(this.current.projectId);
    this.host.emit();
  }

  /** Écriture sans attente (ligne de mission, échec) : une erreur de disque ne casse pas la mission. */
  private persistLater(): void {
    this.persist().catch(() => undefined);
  }

  private patch(id: string, patch: Partial<MissionStep>): void {
    if (this.current) patchStep(this.current, id, patch, this.now);
    this.persistLater();
  }

  private agent(
    id: string,
    patch: Partial<MissionAgentState> & { status?: MissionAgentStatus },
  ): void {
    const mission = this.current;
    if (!mission) return;
    mission.agents ??= [];
    const found = mission.agents.find((agent) => agent.id === id);
    if (found) Object.assign(found, patch);
    if (patch.status === 'running' && found && found.startedAt === undefined) {
      found.startedAt = this.now;
    }
    if (
      found &&
      (patch.status === 'done' || patch.status === 'failed') &&
      found.finishedAt === undefined
    ) {
      found.finishedAt = this.now;
    }
    mission.updatedAt = this.now;
    this.persistLater();
  }

  private installSupervisorPlan(plan: SupervisorPlan, model: string): void {
    const mission = this.current!;
    mission.supervisor = plan;
    const supervisor = mission.agents?.find((agent) => agent.id === 'supervisor');
    mission.agents = [
      supervisor ?? {
        id: 'supervisor',
        name: 'Superviseur',
        role: 'architecture',
        brief: 'Découper la demande et contrôler chaque résultat.',
        context: mission.request,
        modelRequired: true,
        dependsOn: [],
        status: 'done',
        model,
      },
      ...plan.tasks.map(
        (task): MissionAgentState => {
          const modelRequired =
            task.role === 'architecture' ||
            task.role === 'code' ||
            task.role === 'correction';
          return {
            ...task,
            modelRequired,
            status: 'pending',
            ...(modelRequired ? { model } : {}),
          };
        },
      ),
    ];
    this.persistLater();
  }

  private agentByRole(role: SupervisorAgentRole): MissionAgentState | undefined {
    return this.current?.agents?.find((agent) => agent.role === role && agent.id !== 'supervisor');
  }

  private setAgentRole(
    role: SupervisorAgentRole,
    status: MissionAgentStatus,
    detail?: string,
    extra: Partial<MissionAgentState> = {},
  ): void {
    const found = this.current?.agents?.find(
      (agent) =>
        agent.role === role &&
        agent.id !== 'supervisor' &&
        (status === 'running' ? agent.status === 'pending' : agent.status === 'running'),
    ) ?? this.agentByRole(role);
    if (!found) return;
    this.agent(found.id, { status, ...(detail ? { detail } : {}), ...extra });
  }

  private ensureFixAgent(detail: string): MissionAgentState {
    const mission = this.current!;
    const running = mission.agents?.find(
      (agent) => agent.role === 'correction' && agent.status === 'running',
    );
    if (running) return running;
    const count = (mission.agents ?? []).filter((agent) => agent.role === 'correction').length + 1;
    const coder = this.modelFor('CODER');
    const agent: MissionAgentState = {
      id: `fix-${count}`,
      name: `Correcteur ${count}`,
      role: 'correction',
      brief: 'Lire l’erreur réelle, corriger sa cause et relancer les vérifications.',
      context: detail,
      modelRequired: true,
      dependsOn: [this.agentByRole('test')?.id ?? 'code'],
      status: 'running',
      model: coder,
      detail,
      startedAt: this.now,
    };
    mission.agents ??= [];
    mission.agents.push(agent);
    this.persistLater();
    return agent;
  }

  /** Un seul modèle Ollama chargé : tout autre modèle en cours est libéré avant le suivant. */
  private async switchModel(model: string): Promise<void> {
    const running = await this.deps.ollama().running();
    for (const loaded of running) {
      if (loaded.name !== model) await this.deps.ollama().unload(loaded.name);
    }
    this.lastModel = model;
  }

  private async resources(model: string, cwd: string): Promise<MissionStep['resources']> {
    const loaded = (await this.deps.ollama().running()).find((m) => m.name === model);
    const gpu = await readGpuMemory(this.deps.run, cwd);
    return {
      vramBytes: loaded?.sizeVramBytes ?? null,
      ramBytes: loaded ? Math.max(0, loaded.sizeBytes - loaded.sizeVramBytes) : null,
      gpuUsedMiB: gpu.probe === 'ok' ? (parseNvidiaSmi(gpu.output)[0]?.usedMiB ?? null) : null,
    };
  }

  private code(model: string) {
    return createCodeAIProvider(this.deps.registry, {
      model,
      baseUrl: this.deps.ollama().baseUrl,
      options: this.deps.modelOptions(model),
      fetch: patientFetch,
    });
  }

  /** Lance un spécialiste et met à jour sa ligne : modèle, tours, fichiers lus, sortie, ressources. */
  private async specialist<T>(
    stepId: string,
    role: SpecialistRole,
    call: Omit<SpecialistCall<T>, 'role' | 'signal' | 'beforeRound'>,
    signal: AbortSignal,
    cwd: string,
  ): Promise<SpecialistRun<T>> {
    const model = this.modelFor(role);
    await this.switchModel(model);
    this.activeRole = role;
    this.patch(stepId, { status: 'running', model, detail: `${ROLE_LABELS[role]} au travail` });
    try {
      const run = await runSpecialist(this.code(model), {
        ...call,
        role,
        signal,
        beforeRound: () => this.host.pause(model, signal),
      });
      const files = [
        ...new Set(
          run.calls
            .map((c) => c.arguments.path)
            .filter((p): p is string => typeof p === 'string' && p.length > 0),
        ),
      ];
      this.patch(stepId, {
        status: 'done',
        output: run.output,
        rounds: run.rounds,
        files,
        tokPerSec: speed(run.usage),
        detail: run.retried ? 'réponse reformulée une fois' : 'réponse au format',
        resources: await this.resources(model, cwd),
      });
      return run;
    } catch (error) {
      this.patch(stepId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.activeRole = null;
    }
  }

  async listMissions(projectId: string = MISSION_PROJECT_ID): Promise<DeveloperState> {
    this.historyProject = projectId;
    this.history = await this.deps.store.list(projectId);
    return this.host.emit();
  }

  async openMission(id: string, projectId: string = MISSION_PROJECT_ID): Promise<DeveloperState> {
    if (this.current && (this.current.status === 'running' || this.current.status === 'task'))
      return this.host.notice('Une mission est en cours : attends sa fin ou annule-la.');
    const mission = await this.deps.store.load(projectId, id);
    if (!mission) return this.host.notice('Mission introuvable.');
    this.current = mission;
    this.project = null;
    return this.host.emit();
  }

  /** Mémoire du projet et missions récentes, données aux spécialistes. */
  private async loadMemory(projectId: string): Promise<string> {
    const notes = await this.deps.projects.memoryNotes(projectId);
    const history = (await this.deps.store.list(projectId)).filter(
      (m) => m.id !== this.current?.id,
    );
    return memoryBlock(notes, history);
  }

  async start(
    kind: MissionKind,
    request: string,
    skipQuestions: boolean,
    projectId: string = MISSION_PROJECT_ID,
    link?: { missionId: string; index: number },
    chatExtras?: MissionStartExtras,
  ): Promise<DeveloperState> {
    let text = request.trim();
    if (kind === 'new-project') skipQuestions = true;
    if (text.length < (kind === 'question' ? 4 : 8))
      return this.host.notice('Décris la mission en une phrase au moins.');
    if (text.length > 2_000)
      return this.host.notice('Demande trop longue (2 000 caractères au plus).');
    const status = await this.deps.ollama().status();
    const installed = new Set(status.models.map((m) => m.name));
    const plan = buildMissionModelPlan(
      kind,
      this.developer(),
      installed,
      (await this.deps.modelRuns?.()) ?? [],
      this.deps.realBenches?.(),
    );
    if (!(plan instanceof Map)) return this.host.notice(plan.error);
    for (const route of plan.values()) {
      if (route.logLine) this.deps.log?.(`[modèles] ${route.logLine}`);
    }
    this.modelPlan = plan;
    const coder = plan.get('CODER')?.model ?? this.developer().codeModel.trim();
    this.gate =
      coder && GATED_MISSION_KINDS.includes(kind)
        ? assessMission(
            kind,
            text,
            modelCapability(
              coder,
              this.deps.realBenches?.().find((b) => b.model === coder),
              status.models.find((m) => m.name === coder)?.parameterSize,
            ),
          )
        : null;
    if (this.gate && !this.gate.ok) return this.host.notice(this.gate.message);
    const creates = kind === 'new-project' || kind === 'skill';
    let project: ResolvedProject | null = null;
    let missionProjectId = NEW_PROJECT_SCOPE;
    if (!creates) {
      const resolved = await this.deps.projects.resolve(projectId);
      if (typeof resolved === 'string') return this.host.notice(resolved);
      project = resolved;
      missionProjectId = project.id;
    } else if (
      kind === 'new-project' &&
      projectId &&
      projectId !== MISSION_PROJECT_ID
    ) {
      const resolved = await this.deps.projects.resolve(projectId);
      if (typeof resolved === 'string') return this.host.notice(resolved);
      missionProjectId = projectId;
    }
    this.project = project;
    this.memory =
      missionProjectId !== NEW_PROJECT_SCOPE
        ? await this.loadMemory(missionProjectId)
        : project
          ? await this.loadMemory(project.id)
          : '';
    this.current = createMission({
      id: `${new Date(this.now).toISOString().slice(0, 10)}-${randomId().slice(0, 8)}`,
      projectId: missionProjectId,
      kind,
      request: text,
      skipQuestions,
      now: this.now,
    });
    if (link) this.current.fromProposal = link;
    if (this.gate) this.current.gate = this.gate;
    if (chatExtras?.discussionContext)
      this.current.discussionContext = chatExtras.discussionContext.slice(0, 24_000);
    if (chatExtras?.coderOverride) this.current.coderOverride = chatExtras.coderOverride;
    if (chatExtras?.projectDecisions?.length)
      this.current.projectDecisions = chatExtras.projectDecisions.slice(0, 40);
    this.counters.clear();
    this.open.clear();
    await this.persist();
    if (link && project) {
      const source = await this.deps.store.load(project.id, link.missionId);
      const proposal = source?.proposals?.[link.index];
      if (source && proposal) {
        proposal.missionId = this.current.id;
        await this.deps.store.save(source);
      }
    }
    const cwd = project?.root ?? homedir();
    if (kind === 'question') return this.answerQuestion(cwd);
    if (kind === 'improve') return this.improveFlow(cwd);
    const state = await this.goalPhase(cwd);
    if (this.current.status !== 'running') return state;
    return creates ? this.factoryAndTask() : this.designAndTask(cwd);
  }

  /** Réponses de l'utilisateur aux questions de l'objectif ; vides = continuer sans répondre. */
  async answer(answers: string[]): Promise<DeveloperState> {
    const mission = this.current;
    if (!mission || mission.status !== 'waiting-answers')
      return this.host.notice('Aucune mission n’attend de réponse.');
    const creates = mission.kind === 'new-project' || mission.kind === 'skill';
    if (!creates && this.project?.id !== mission.projectId) {
      const resolved = await this.deps.projects.resolve(mission.projectId);
      if (typeof resolved === 'string') return this.host.notice(resolved);
      this.project = resolved;
      this.memory = await this.loadMemory(resolved.id);
    }
    mission.answers = (mission.goal?.questions ?? []).map((question, i) => ({
      question,
      answer: (answers[i] ?? '').slice(0, 1_000),
    }));
    mission.status = 'running';
    this.patch('goal', { status: 'done', detail: 'réponses reçues' });
    return creates ? this.factoryAndTask() : this.designAndTask(this.project!.root);
  }

  private fail(message: string, signal?: AbortSignal): void {
    if (!this.current) return;
    this.current.status = signal?.aborted ? 'cancelled' : 'failed';
    this.current.verdict = 'stopped';
    this.current.summary = message;
    if (!signal?.aborted)
      this.deps.onMissionChatLine?.(developerMissionFailureLine(message));
    this.persistLater();
  }

  private async answerQuestion(root: string): Promise<DeveloperState> {
    const mission = this.current!;
    const model = this.modelFor('REASONER');
    return this.host.runTask(
      'mission',
      `Mission : ${MISSION_LABELS.question}`,
      [{ id: 'answer', label: 'Raisonnement : réponse (lecture seule)' }],
      async (step, signal) => {
        step('answer', 'running', model);
        await this.switchModel(model);
        this.activeRole = 'REASONER';
        this.patch('answer', { status: 'running', model });
        try {
          const result = await runAsk(
            {
              code: this.code(model),
              tools: this.host.readTools(root),
              read: repoReader(root),
              profile: this.profile,
              signal,
              limit: STEP_LIMITS.answer,
              beforeRound: () => this.host.pause(model, signal),
            },
            mission.request,
          );
          this.patch('answer', {
            status: result.checked.verified > 0 ? 'done' : 'failed',
            output: result.checked,
            rounds: result.rounds,
            files: result.checked.citations.map((c) => c.path),
            tokPerSec: speed(result.usage),
            detail: `${result.checked.verified}/${result.checked.citations.length} citation(s) vérifiée(s)`,
            resources: await this.resources(model, root),
          });
          mission.status = 'finished';
          mission.verdict = result.checked.verified > 0 ? 'success' : 'failed';
          mission.summary = result.checked.answer;
          await this.persist();
          step('answer', 'done');
          return 'Réponse prête (onglet Missions).';
        } catch (error) {
          this.patch('answer', { status: 'failed', error: String(error) });
          this.fail(error instanceof Error ? error.message : String(error), signal);
          throw error;
        } finally {
          this.activeRole = null;
        }
      },
    );
  }

  private async goalPhase(root: string): Promise<DeveloperState> {
    const mission = this.current!;
    return this.host.runTask(
      'mission',
      `Mission : ${MISSION_LABELS[mission.kind]}`,
      [{ id: 'goal', label: 'Raisonnement : objectif, critères et questions' }],
      async (step, signal) => {
        if (mission.kind === 'new-project') {
          const reuseId =
            mission.projectId !== NEW_PROJECT_SCOPE ? mission.projectId : undefined;
          const supervisorModel = this.modelFor('CODER');
          mission.agents = [
            {
              id: 'supervisor',
              name: 'Superviseur',
              role: 'architecture',
              brief: 'Lire l’ordre, créer les agents nécessaires et contrôler leurs résultats.',
              context: mission.request,
              modelRequired: true,
              dependsOn: [],
              status: 'running',
              model: supervisorModel,
              startedAt: this.now,
            },
          ];
          this.deps.onMissionChatLine?.(
            `▶ Superviseur (${supervisorModel}) — découpe la demande en agents`,
          );
          const supervisorPromise = (async (): Promise<SupervisorPlan> => {
            try {
              const run = await this.specialist(
                'supervisor',
                'CODER',
                {
                  system: supervisorSystem(),
                  prompt: supervisorPrompt(mission.request),
                  schema: supervisorPlanSchema,
                  limit: STEP_LIMITS.goal,
                },
                signal,
                homedir(),
              );
              return run.output;
            } catch (error) {
              if (!(error instanceof SpecialistError) || signal.aborted) throw error;
              const fallback = fallbackSupervisorPlan(mission.request);
              this.patch('supervisor', {
                status: 'done',
                output: fallback,
                detail: `plan local de secours : ${error.message}`,
                error: undefined,
              });
              return fallback;
            }
          })();
          this.patch('scaffold', { status: 'running', detail: 'dossier du projet' });
          step('scaffold', 'running');
          this.deps.onMissionChatLine?.(
            developerAgentStarted('preparer', 'prépare le dossier du projet'),
          );
          const scaffoldPromise = this.deps.projects.scaffoldMissionFolder(
            mission.request,
            reuseId,
          );
          this.patch('web-research', { status: 'running', detail: 'recherche sur le web' });
          step('web-research', 'running');
          this.deps.onMissionChatLine?.(
            developerAgentStarted('web', 'cherche comment construire ce type de projet'),
          );
          const webPromise = (async () => {
            const query = webResearchQueryForRequest(mission.request);
            const summary = await this.deps.webResearch?.(query, mission.request);
            if (summary) {
              this.deps.onMissionChatLine?.(
                developerAgentFinished('web', summary.chatLine.replace(/^Recherche web : /, '')),
              );
              return summary;
            }
            this.deps.onMissionChatLine?.(
              developerAgentFinished('web', 'pas de source web exploitable, je continue avec le gabarit'),
            );
            return null;
          })();
          const [scaffoldOutcome, webSummary, supervisorPlan] = await Promise.all([
            scaffoldPromise,
            webPromise,
            supervisorPromise,
          ]);
          this.installSupervisorPlan(supervisorPlan, supervisorModel);
          this.agent('supervisor', {
            status: 'done',
            detail: `${supervisorPlan.tasks.length} agent(s) créé(s) selon la demande`,
            output: supervisorPlan,
          });
          this.deps.onMissionChatLine?.(
            `✓ Superviseur — ${supervisorPlan.tasks.length} agent(s) créés`,
          );
          if (typeof scaffoldOutcome === 'string') {
            this.deps.onMissionChatLine?.(developerAgentFinished('preparer', scaffoldOutcome));
            this.patch('scaffold', { status: 'failed', detail: scaffoldOutcome });
            step('scaffold', 'failed', scaffoldOutcome);
            throw new Error(scaffoldOutcome);
          }
          const fromScope = mission.projectId;
          mission.projectId = scaffoldOutcome.projectId;
          if (fromScope !== mission.projectId) await this.deps.store.move(mission, fromScope);
          this.deps.onMissionFocusProject?.(scaffoldOutcome.projectId);
          this.deps.onMissionChatLine?.(
            developerAgentFinished(
              'preparer',
              scaffoldOutcome.alreadyThere
                ? `projet déjà là : ${scaffoldOutcome.path}`
                : `dossier prêt : ${scaffoldOutcome.path}`,
            ),
          );
          this.patch('scaffold', { status: 'done', detail: scaffoldOutcome.path });
          this.setAgentRole('préparation', 'done', scaffoldOutcome.path);
          step('scaffold', 'done', scaffoldOutcome.path);
          if (webSummary) {
            this.patch('web-research', { status: 'done', detail: webSummary.chatLine.slice(0, 160) });
            step('web-research', 'done', webSummary.chatLine.slice(0, 80));
            mission.discussionContext = `${mission.discussionContext ?? ''}\n\n${webSummary.coderBlock}\n\n${webSummary.chatLine}`.slice(
              0,
              24_000,
            );
            this.setAgentRole('recherche', 'done', webSummary.chatLine.slice(0, 200));
          } else {
            this.patch('web-research', { status: 'skipped', detail: 'recherche web indisponible' });
            step('web-research', 'done', 'sans résultat exploitable');
            this.setAgentRole(
              'recherche',
              'done',
              'Aucune source web exploitable ; poursuite avec les connaissances locales.',
            );
          }
          await this.persist();
        }
        step('goal', 'running');
        try {
          let output: GoalOutput;
          if (mission.kind === 'new-project' && mission.skipQuestions) {
            output = fallbackGoal(mission.request, mission.kind);
            this.patch('goal', {
              status: 'done',
              output,
              detail: 'objectif direct, sans questionnaire',
            });
          } else {
            try {
              const run = await this.specialist(
                'goal',
                'REASONER',
                {
                  system: goalSystem(
                    this.project || !createsProject(mission.kind)
                      ? this.profile
                      : NEW_PROJECT_CONTEXT,
                    mission.skipQuestions ? 0 : MAX_GOAL_QUESTIONS,
                  ),
                  prompt: this.memory
                    ? `${goalPrompt(mission.request)}\n\nMémoire du projet :\n${this.memory}`
                    : goalPrompt(mission.request),
                  schema: goalSchema,
                  limit: STEP_LIMITS.goal,
                },
                signal,
                root,
              );
              output = run.output;
            } catch (error) {
              if (!(error instanceof SpecialistError) || signal.aborted) throw error;
              output = fallbackGoal(mission.request, mission.kind);
              this.patch('goal', {
                status: 'done',
                output,
                detail: `objectif de secours, tiré de ta demande : ${error.message}`,
                error: undefined,
              });
            }
          }
          const goal = {
            ...output,
            questions: mission.skipQuestions ? [] : output.questions.slice(0, MAX_GOAL_QUESTIONS),
          };
          mission.goal = goal;
          if (goal.questions.length) {
            mission.status = 'waiting-answers';
            this.patch('goal', {
              status: 'waiting',
              detail: `${goal.questions.length} question(s) pour toi`,
            });
            step('goal', 'done', 'questions posées');
            return 'L’objectif est prêt ; réponds aux questions (onglet Missions) pour continuer.';
          }
          await this.persist();
          step('goal', 'done', goal.goal);
          return 'Objectif prêt.';
        } catch (error) {
          this.fail(error instanceof Error ? error.message : String(error), signal);
          throw error;
        }
      },
    );
  }

  private brief(): MissionBrief {
    const mission = this.current!;
    return {
      request: mission.request,
      goal: mission.goal,
      answers: mission.answers,
      ...(this.memory ? { memory: this.memory } : {}),
    };
  }

  private async designAndTask(root: string): Promise<DeveloperState> {
    const mission = this.current!;
    const role = (
      mission.kind === 'fix'
        ? 'DEBUGGER'
        : mission.kind === 'document'
          ? 'DOCUMENTATION'
          : 'ARCHITECT'
    ) as 'ARCHITECT' | 'DEBUGGER' | 'DOCUMENTATION';
    let context = '';
    const designed = await this.host.runTask(
      'mission',
      `Mission : conception (${ROLE_LABELS[role]})`,
      [{ id: 'design', label: `${ROLE_LABELS[role]} : conception (lecture seule)` }],
      async (step, signal) => {
        step('design', 'running');
        try {
          const schema =
            role === 'ARCHITECT'
              ? architectSchema
              : role === 'DEBUGGER'
                ? debuggerSchema
                : documentationSchema;
          let run: SpecialistRun<ArchitectOutput | DebuggerOutput | DocumentationOutput>;
          try {
            run = await this.specialist<ArchitectOutput | DebuggerOutput | DocumentationOutput>(
              'design',
              role,
              {
                system: designSystem(role, this.profile),
                prompt: designPrompt(this.brief()),
                schema: schema as never,
                tools: this.host.readTools(root),
                maxRounds: 10,
                limit: STEP_LIMITS.design,
              },
              signal,
              root,
            );
          } catch (error) {
            if (!(error instanceof SpecialistError) || signal.aborted) throw error;
            context = [
              'Contexte de la mission (la conception n’a pas abouti : pars de la demande) :',
              briefBlock(this.brief()),
            ].join('\n');
            this.patch('design', {
              status: 'skipped',
              detail: `conception non rendue (${error.message}) : le plan part de la demande`,
              error: undefined,
            });
            step('design', 'done', 'sans conception');
            return 'Conception non rendue : le plan de modification part de la demande.';
          }
          context = designContext(role, run.output, this.brief());
          step('design', 'done');
          return 'Conception prête : le plan de modification suit.';
        } catch (error) {
          this.fail(error instanceof Error ? error.message : String(error), signal);
          throw error;
        }
      },
    );
    if (mission.status !== 'running' || !context) return designed;
    mission.status = 'task';
    await this.persist();
    const coder = this.modelFor('CODER');
    await this.switchModel(coder);
    await this.host.startTask(mission.request, {
      model: coder,
      hooks: this.loopHooks(root, coder, this.enrichedPlanContext(context)),
      templateId: this.project?.template,
      ...(this.project && this.project.id !== JARVIS_PROJECT_ID
        ? {
            project: {
              id: this.project.id,
              root,
              profile: this.project.profile,
              templateId: this.project.template,
            },
          }
        : {}),
    });
    await this.finishFromTask();
    return this.host.emit();
  }

  /**
   * « Nouveau projet » : l'ARCHITECTE choisit un gabarit et un nom ; « Compétence »
   * (0.5.5) : le RESEARCHER propose des technologies locales, l'ARCHITECTE conçoit
   * les outils, le gabarit est `node-skill` (hors du chat). Puis l'utilisateur
   * valide la création (carte) et la boucle de modification travaille sur le
   * projet neuf, dans sa propre copie isolée.
   */
  private async factoryAndTask(): Promise<DeveloperState> {
    const mission = this.current!;
    const skill = mission.kind === 'skill';
    const result: {
      project: ResolvedProject | null;
      template: ProjectTemplateId | null;
      research: ResearcherOutput | null;
      design: SkillDesign | null;
    } = { project: null, template: null, research: null, design: null };
    const done = await this.host.runTask(
      'mission',
      `Mission : ${MISSION_LABELS[mission.kind]}`,
      [
        ...(skill
          ? [{ id: 'research', label: 'Recherche : technologies locales (sans web)' }]
          : []),
        {
          id: 'design',
          label: skill
            ? 'Architecte : outils de la compétence'
            : 'Architecte : gabarit et nom du projet',
        },
        { id: 'create', label: 'Création du projet (ta confirmation)' },
      ],
      async (step, signal) => {
        try {
          let input: {
            template: ProjectTemplateId;
            name: string;
            description: string;
            skillTools?: Array<{ name: string; description: string }>;
          };
          if (skill) {
            step('research', 'running');
            try {
              const research = await this.specialist(
                'research',
                'RESEARCHER',
                {
                  system: researchSystem(),
                  prompt: briefBlock(this.brief()),
                  schema: researcherSchema,
                  limit: STEP_LIMITS.research,
                },
                signal,
                homedir(),
              );
              result.research = research.output;
              step('research', 'done', `${research.output.findings.length} piste(s), à vérifier`);
            } catch (error) {
              if (!(error instanceof SpecialistError) || signal.aborted) throw error;
              this.patch('research', {
                status: 'skipped',
                detail: `recherche non rendue : ${error.message}`,
                error: undefined,
              });
              step('research', 'done', 'sans recherche');
            }
            step('design', 'running');
            let designed: SkillDesign;
            try {
              const design = await this.specialist(
                'design',
                'ARCHITECT',
                {
                  system: skillSystem(),
                  prompt: skillPrompt(this.brief(), result.research),
                  schema: skillSchema,
                  limit: STEP_LIMITS.skill,
                },
                signal,
                homedir(),
              );
              designed = design.output;
            } catch (error) {
              if (!(error instanceof SpecialistError) || signal.aborted) throw error;
              designed = fallbackSkill(mission.request);
              this.patch('design', {
                status: 'done',
                output: designed,
                detail: `conception de secours (un outil tiré de ta demande) : ${error.message}`,
                error: undefined,
              });
            }
            const design = { output: designed };
            result.design = design.output;
            step(
              'design',
              'done',
              `${design.output.skill} · ${design.output.tools.length} outil(s)`,
            );
            input = {
              template: SKILL_TEMPLATE_ID,
              name: design.output.skill,
              description: design.output.description,
              skillTools: design.output.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
              })),
            };
          } else {
            step('design', 'running');
            this.setAgentRole('architecture', 'running', 'choisit le gabarit et les modules');
            let chosen: FactoryOutput;
            let note = '';
            const fastDesign = mission.kind === 'new-project' && mission.skipQuestions;
            if (fastDesign) {
              this.deps.onMissionChatLine?.(
                developerAgentStarted('architecte', 'choisit le gabarit adapté'),
              );
              chosen = steerFactory(mission.request, fallbackFactory(mission.request));
              note = ' (règles rapides, un seul modèle ensuite)';
              this.patch('design', {
                status: 'done',
                output: chosen,
                detail: `${PROJECT_TEMPLATES[chosen.template].label} · ${chosen.name}${note}`,
              });
              this.deps.onMissionChatLine?.(
                developerAgentFinished(
                  'architecte',
                  `${PROJECT_TEMPLATES[chosen.template].label} · ${chosen.name}`,
                ),
              );
              step(
                'design',
                'done',
                `${PROJECT_TEMPLATES[chosen.template].label} · ${chosen.name}${note}`,
              );
            } else
            try {
              const run = await this.specialist(
                'design',
                'ARCHITECT',
                {
                  system: factorySystem(),
                  prompt: factoryPrompt(this.brief()),
                  schema: factorySchema,
                  limit: STEP_LIMITS.factory,
                },
                signal,
                homedir(),
              );
              chosen = steerFactory(mission.request, run.output);
              if (chosen.template !== run.output.template) {
                note =
                  chosen.template === 'web-game'
                    ? ` (règle fixe : un jeu part du gabarit jeu, au lieu de « ${PROJECT_TEMPLATES[run.output.template].label} »)`
                    : chosen.template === 'dotnet-winforms'
                      ? ` (règle fixe : une appli Windows .exe part du gabarit WinForms, au lieu de « ${PROJECT_TEMPLATES[run.output.template].label} »)`
                      : ` (règle fixe : gabarit « ${PROJECT_TEMPLATES[chosen.template].label} » au lieu de « ${PROJECT_TEMPLATES[run.output.template].label} »)`;
                this.patch('design', {
                  output: chosen,
                  detail: `${PROJECT_TEMPLATES[chosen.template].label} · ${chosen.name}${note}`,
                });
              }
            } catch (error) {
              if (!(error instanceof SpecialistError) || signal.aborted) throw error;
              chosen = fallbackFactory(mission.request);
              this.patch('design', {
                status: 'done',
                output: chosen,
                detail: `choix de secours, par règles fixes : ${PROJECT_TEMPLATES[chosen.template].label} · ${chosen.name} (${error.message})`,
                error: undefined,
              });
            }
            if (!fastDesign)
              step(
                'design',
                'done',
                `${PROJECT_TEMPLATES[chosen.template].label} · ${chosen.name}${note}`,
              );
            this.setAgentRole(
              'architecture',
              'done',
              `${PROJECT_TEMPLATES[chosen.template].label} · ${chosen.name}`,
              { output: chosen },
            );
            input = chosen;
          }
          result.template = input.template;
          this.patch('create', { status: 'waiting', detail: 'ta confirmation' });
          const from = mission.projectId;
          try {
            const reuseEntryId =
              mission.kind === 'new-project' && mission.projectId !== NEW_PROJECT_SCOPE
                ? mission.projectId
                : undefined;
            if (reuseEntryId) {
              const existing = await this.deps.projects.resolve(reuseEntryId);
              if (typeof existing !== 'string' && existing.origin === 'created' && existing.template) {
                result.project = existing;
                this.patch('create', {
                  status: 'skipped',
                  detail: 'projet déjà créé, pas de nouvelle installation',
                });
                step('create', 'skipped', existing.root);
                mission.projectId = existing.id;
                await this.persist();
              }
            }
            if (!result.project)
            result.project = await this.deps.projects.create(
              input,
              step,
              signal,
              reuseEntryId
                ? {
                    reuseEntryId,
                    trustedMissionCreate: mission.kind === 'new-project',
                  }
                : undefined,
            );
          } catch (error) {
            this.patch('create', {
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
          const project = result.project;
          if (!project) {
            this.patch('create', { status: 'failed', detail: 'refusée' });
            mission.status = 'cancelled';
            mission.verdict = 'stopped';
            mission.summary = 'Création refusée : rien n’a été écrit.';
            await this.persist();
            step('create', 'failed', 'refusée');
            return mission.summary;
          }
          this.patch('create', { status: 'done', detail: project.root, files: [project.root] });
          mission.projectId = project.id;
          await this.deps.store.move(mission, from);
          await this.persist();
          return `Projet créé : ${project.root}.`;
        } catch (error) {
          if (mission.status === 'running')
            this.fail(error instanceof Error ? error.message : String(error), signal);
          throw error;
        }
      },
    );
    const { project, template, design, research } = result;
    if (!project || mission.status !== 'running') return done;
    this.project = project;
    mission.status = 'task';
    await this.persist();
    try {
    const coder = this.modelFor('CODER');
    await this.switchModel(coder);
    const codeAgents = (mission.agents ?? []).filter((agent) => agent.role === 'code');
    for (const agent of codeAgents) {
      this.agent(agent.id, {
        status: 'running',
        model: coder,
        detail: agent.brief,
      });
    }
    this.deps.onMissionChatLine?.(developerAgentStarted('codeur', 'écrit le code et adapte les tests'));
    const repoMap = await this.repoMapOutline(project.root);
    const context = [
      'Contexte de la mission (préparé par les spécialistes, à respecter) :',
      ...(repoMap ? [repoMap] : []),
      briefBlock(this.brief()),
      `Projet neuf, créé depuis le gabarit « ${template ? PROJECT_TEMPLATES[template].label : '?'} » : lis ses fichiers, écris le programme demandé et adapte les tests (gabarit neutre pour web-game).`,
      ...(template && TEMPLATE_GUIDES[template] ? [TEMPLATE_GUIDES[template]] : []),
      ...(design ? [skillTaskContext(design, research)] : []),
      ...codeAgents.map(
        (agent) =>
          `Agent ${agent.name} — brief : ${agent.brief}\nContexte propre : ${agent.context}`,
      ),
    ].join('\n');
    const fallbackPlan = template ? templatePlan(template, mission.request, project.name) : null;
    await this.host.startTask(mission.request, {
      model: coder,
      templateId: template ?? undefined,
      hooks: {
        ...this.loopHooks(project.root, coder, this.enrichedPlanContext(context)),
        ...(fallbackPlan ? { fallbackPlan } : {}),
        fileByFile: {
          references:
            template && isDotnetWindowsDesktopTemplate(template)
              ? dotnetDesktopTemplateReferences(template, project.name)
              : template
                ? (TEMPLATE_REFERENCES[template] ?? [])
                : [],
          guide: [
            template ? TEMPLATE_GUIDES[template] : undefined,
            design ? skillTaskContext(design, research) : undefined,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      },
      project: {
        id: project.id,
        root: project.root,
        profile: project.profile,
        templateId: template ?? undefined,
      },
    });
    await this.finishFromTask();
    let merged = false;
    if (mission.verdict === 'success' && this.host.applyTaskToProject) {
      const applied = await this.host.applyTaskToProject();
      const task = this.host.currentTask() ?? applied.codeTask;
      merged = Boolean(task?.applied && task.applied.revertedAt === null);
      if (merged && task?.worktreePath) {
        await this.syncDeliveredFiles(
          task.worktreePath,
          project.root,
          task.diff.map((f) => f.path),
        );
      }
      if (merged) {
        mission.summary = `Livré : ${task?.diff.length ?? 0} fichier(s) fusionnés dans ${project.root}.`;
        for (const agent of codeAgents) {
          this.agent(agent.id, {
            status: 'done',
            detail: `${task?.diff.length ?? 0} fichier(s) livré(s)`,
            files: task?.diff.map((file) => file.path) ?? [],
          });
        }
      } else {
        mission.verdict = 'failed';
        mission.status = 'failed';
        mission.summary = 'Échec : la fusion dans le dossier projet a échoué.';
      }
    }
    if (mission.verdict === 'success' && merged) {
      this.deps.onMissionChatLine?.(
        developerAgentFinished('codeur', mission.summary?.slice(0, 120) ?? 'code livré'),
      );
    } else if (mission.verdict === 'failed' || mission.verdict === 'stopped') {
      for (const agent of codeAgents.filter((agent) => agent.status !== 'done')) {
        this.agent(agent.id, {
          status: 'failed',
          error: mission.summary?.slice(0, 300) ?? 'mission interrompue',
        });
      }
      this.deps.onMissionChatLine?.(
        developerAgentFailed('codeur', mission.summary?.slice(0, 160) ?? 'mission interrompue'),
      );
    }
    if (mission.verdict === 'success' && merged && project) {
      this.deps.onMissionFocusProject?.(project.id);
      this.setAgentRole('package', 'running', 'prépare le livrable et le raccourci Bureau');
      await this.deliverWindowsExeIfRequested(template ?? undefined, mission.request, mission.projectId!);
      const shortcut = await this.host.deliverDesktopShortcut?.(project, mission.request);
      if (shortcut) this.deps.onMissionChatLine?.(`Raccourci bureau : ${shortcut}`);
      this.setAgentRole(
        'package',
        shortcut ? 'done' : 'failed',
        shortcut ? `Raccourci Bureau : ${shortcut}` : 'Aucun raccourci n’a pu être créé.',
        shortcut ? {} : { error: 'Le raccourci Bureau n’a pas été créé.' },
      );
      const doneAgents = (mission.agents ?? []).filter((agent) => agent.status === 'done').length;
      const failedAgents = (mission.agents ?? []).filter((agent) => agent.status === 'failed').length;
      mission.summary = `Superviseur : ${doneAgents} agent(s) terminés${failedAgents ? `, ${failedAgents} en échec` : ''}. ${mission.summary ?? ''}`.trim();
      this.deps.onMissionChatLine?.(mission.summary);
    }
    return this.host.emit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setAgentRole('package', 'failed', message, { error: message });
      this.fail(message);
      return this.host.emit();
    }
  }

  /** Demande .exe : fusionne la copie isolée puis publie win-x64 (chemin utilisateur normal). */
  private async deliverWindowsExeIfRequested(
    template: ProjectTemplateId | undefined,
    request: string,
    projectId: string,
  ): Promise<void> {
    const mission = this.current;
    if (!mission || mission.verdict !== 'success' || !template) return;
    if (!isDotnetWindowsDesktopTemplate(template) || !DESKTOP_WINDOWS_EXE.test(request)) return;
    if (!this.host.deliverWindowsExe) return;
    const task = this.host.currentTask();
    if (task?.report?.verdict !== 'success') return;
    this.deps.log?.(
      `[mission] Livraison .exe : application de la tâche puis dotnet publish win-x64 sur le projet.`,
    );
    const state = await this.host.deliverWindowsExe(projectId);
    const notice = state.notice;
    if (notice) mission.summary = `${mission.summary} ${notice}`.trim();
  }

  /**
   * « Améliorer » (0.5.5) : mesures fixes par Jarvis, propositions de
   * l'ARCHITECTE en lecture seule, puis chaque preuve relue. Rien n'est modifié ;
   * une proposition retenue devient une mission sur demande de l'utilisateur.
   */
  private async improveFlow(root: string): Promise<DeveloperState> {
    const mission = this.current!;
    return this.host.runTask(
      'mission',
      `Mission : ${MISSION_LABELS.improve}`,
      [
        { id: 'measure', label: 'Mesures fixes (sans modèle)' },
        { id: 'proposals', label: 'Architecte : propositions avec preuves (lecture seule)' },
        { id: 'verify', label: 'Preuves relues dans les fichiers (sans modèle)' },
      ],
      async (step, signal) => {
        try {
          step('measure', 'running');
          this.patch('measure', { status: 'running' });
          const metrics = computeMetrics(await gatherCodeFiles(this.deps.run, root));
          this.patch('measure', {
            status: 'done',
            detail: `${metrics.files} fichiers de code, ${metrics.lines} lignes, ${metrics.tests} fichiers de test, ${metrics.todos.length} TODO, ${metrics.untested.length} sans test`,
            output: metrics,
          });
          step('measure', 'done', `${metrics.files} fichiers de code`);
          step('proposals', 'running');
          const run = await this.specialist(
            'proposals',
            'ARCHITECT',
            {
              system: improveSystem(this.profile),
              prompt: improvePrompt(this.brief(), metrics),
              schema: improveSchema,
              tools: this.host.readTools(root),
              maxRounds: 10,
              limit: STEP_LIMITS.improve,
            },
            signal,
            root,
          );
          step('proposals', 'done', `${run.output.proposals.length} proposition(s)`);
          step('verify', 'running');
          this.patch('verify', { status: 'running' });
          const checked = await verifyProposals(
            run.output.proposals,
            repoReader(root),
            metricIds(metrics),
          );
          const retained = checked.filter((p) => p.retained).length;
          mission.proposals = checked;
          this.patch('verify', {
            status: 'done',
            detail: `${retained} retenue(s) sur ${checked.length} ; sans preuve vérifiée : « avis non retenu »`,
          });
          mission.status = 'finished';
          mission.verdict = retained > 0 ? 'success' : 'failed';
          mission.summary =
            retained > 0
              ? `${retained} proposition(s) retenue(s) sur ${checked.length}, chacune avec une preuve relue. Choisis celles qui deviennent des missions.`
              : 'Aucune proposition n’a de preuve vérifiable : rien n’est retenu.';
          await this.persist();
          step('verify', 'done', `${retained}/${checked.length} retenue(s)`);
          return mission.summary;
        } catch (error) {
          if (mission.status === 'running')
            this.fail(error instanceof Error ? error.message : String(error), signal);
          throw error;
        }
      },
    );
  }

  /** Une proposition retenue d'une mission « Améliorer » devient une mission sur le même projet. */
  async startProposal(
    missionId: string,
    index: number,
    projectId: string,
  ): Promise<DeveloperState> {
    if (this.current && (this.current.status === 'running' || this.current.status === 'task'))
      return this.host.notice('Une mission est en cours : attends sa fin ou annule-la.');
    const source = await this.deps.store.load(projectId, missionId);
    const proposal = source?.proposals?.[index];
    if (!source || source.kind !== 'improve' || !proposal)
      return this.host.notice('Proposition introuvable.');
    if (!proposal.retained)
      return this.host.notice(
        'Avis non retenu : sans preuve vérifiée, il ne devient pas une mission.',
      );
    if (proposal.missionId) return this.host.notice('Cette proposition a déjà sa mission.');
    return this.start(proposalMissionKind(proposal), proposalRequest(proposal), false, projectId, {
      missionId,
      index,
    });
  }

  /** Copie les fichiers livrés dans le dossier projet (secours si la fusion git est déjà à jour). */
  private async syncDeliveredFiles(
    worktreePath: string,
    projectRoot: string,
    paths: string[],
  ): Promise<void> {
    let rels = paths;
    if (!rels.length) {
      const status = await this.deps.run({
        program: 'git',
        args: ['status', '--porcelain=v1'],
        cwd: worktreePath,
        display: 'git status --porcelain=v1',
        timeoutMs: 60_000,
        maxBytes: 200_000,
      });
      if (status.code === 0) {
        rels = status.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.slice(3).trim())
          .filter(Boolean);
      }
      if (!rels.length) {
        const listed = await this.deps.run({
          program: 'git',
          args: ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
          cwd: worktreePath,
          display: 'git diff-tree --name-only HEAD',
          timeoutMs: 60_000,
          maxBytes: 200_000,
        });
        if (listed.code === 0) {
          rels = listed.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        }
      }
    }
    for (const rel of rels) {
      const src = join(worktreePath, rel);
      if (!existsSync(src)) continue;
      const dst = join(projectRoot, rel);
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
    }
  }

  private loopHooks(root: string, coder: string, planContext: string): TaskHooks {
    const onPhase: TaskHooks['onPhase'] = (phase, status, detail, extra) => {
      const mission = this.current;
      if (!mission) return;
      if (phase === 'test') {
        if (status === 'running') {
          this.setAgentRole('test', 'running', detail ?? 'lance les vérifications réelles');
        } else if (status === 'done') {
          this.setAgentRole('test', 'done', detail ?? 'tests et lancement réussis');
        } else {
          this.setAgentRole('test', 'failed', detail ?? 'vérification en échec', {
            error: detail ?? 'vérification en échec',
          });
        }
      }
      if (phase === 'diagnose' && status === 'running') {
        this.ensureFixAgent(detail ?? 'lit la sortie d’échec réelle');
      }
      if (phase === 'fix' && status !== 'running') {
        const fixer = mission.agents?.find(
          (agent) => agent.role === 'correction' && agent.status === 'running',
        );
        if (fixer) {
          this.agent(fixer.id, {
            status: status === 'done' ? 'done' : 'failed',
            detail,
            ...(status === 'failed' ? { error: detail ?? 'correction en échec' } : {}),
            ...(extra?.files ? { files: extra.files } : {}),
          });
        }
      }
      if (mission.kind === 'new-project' && phase === 'test') {
        if (status === 'running') {
          this.deps.onMissionChatLine?.(
            developerAgentStarted('testeur', 'vérifie que le projet tourne'),
          );
        } else if (status === 'done') {
          this.deps.onMissionChatLine?.(
            developerAgentFinished('testeur', detail?.trim() || 'tests terminés'),
          );
        } else if (status === 'failed') {
          this.deps.onMissionChatLine?.(
            developerAgentFinished('testeur', detail?.trim() || 'échec des tests'),
          );
        }
      }
      const actor = LOOP_ACTORS[phase];
      if (status === 'running') {
        const n = (this.counters.get(phase) ?? 0) + 1;
        this.counters.set(phase, n);
        const id = `${phase}-${n}`;
        this.open.set(phase, id);
        this.activeRole = actor;
        upsertStep(
          mission,
          {
            id,
            actor,
            label: `${PHASE_LABELS[phase]}${n > 1 ? ` ${n}` : ''}`,
            status: 'running',
            model:
              actor === 'TESTER'
                ? undefined
                : phase === 'review' || phase === 'diagnose'
                  ? this.modelFor(actor)
                  : coder,
            detail,
            startedAt: this.now,
          },
          this.now,
        );
        this.persistLater();
        return;
      }
      const id = this.open.get(phase);
      if (!id) return;
      this.patch(id, {
        status,
        detail,
        ...(extra?.files ? { files: extra.files } : {}),
        ...(extra?.tokPerSec !== undefined ? { tokPerSec: extra.tokPerSec } : {}),
        ...(extra?.rounds !== undefined ? { rounds: extra.rounds } : {}),
        ...(status === 'failed' && detail ? { error: detail } : {}),
      });
      this.activeRole = null;
    };
    const brief = this.brief();
    const kind = this.current?.kind;
    const template = this.project?.template;
    return {
      planContext,
      directRun: kind === 'new-project' || kind === 'modify' || kind === 'fix',
      autoApprovePlan: kind === 'new-project' || kind === 'modify' || kind === 'fix',
      docsOnly: this.current?.kind === 'document',
      runtimeLaunchCheck:
        template === 'web-game' && this.deps.verifyWebGameRuntime
          ? (root, signal) =>
              signal.aborted
                ? Promise.resolve({ ok: false, detail: 'Annulé.' })
                : this.deps.verifyWebGameRuntime!(root)
          : undefined,
      onPhase,
      review: async (diff, signal) => {
        const model = this.modelFor('REVIEWER');
        const id = this.open.get('review')!;
        const run = await this.specialist(
          id,
          'REVIEWER',
          {
            system: reviewSystem(this.profile),
            prompt: reviewPrompt(diff, brief),
            schema: reviewerSchema,
            limit: STEP_LIMITS.review,
          },
          signal,
          root,
        )
          .catch((error: unknown) => {
            if (!(error instanceof SpecialistError) || signal.aborted) throw error;
            return error;
          })
          .finally(() => (model !== coder ? this.switchModel(coder) : undefined));
        if (run instanceof SpecialistError) {
          const summary = `revue non faite (${run.message}) : non bloquante, relis le diff toi-même`;
          this.patch(id, { status: 'skipped', detail: summary, error: undefined });
          const structured = structureReviewerOutput(
            { verdict: 'à revoir', issues: [], recommendations: [] },
            model,
            Date.now(),
            { coderModel: coder },
          );
          structured.summary = summary;
          return { blocking: [], model, summary, structured };
        }
        const structured = structureReviewerOutput(run.output, model, Date.now(), {
          coderModel: coder,
        });
        return {
          blocking: structured.blocking,
          model,
          summary: structured.summary,
          structured,
        };
      },
      diagnose: async (failures, excerpts, signal, tools) => {
        const model = this.modelFor('DEBUGGER');
        const id = this.open.get('diagnose')!;
        const run = await this.specialist(
          id,
          'DEBUGGER',
          {
            system: diagnoseSystem(this.profile),
            prompt: diagnosePrompt(failures, excerpts),
            schema: debuggerSchema,
            tools,
            maxRounds: 6,
            limit: STEP_LIMITS.diagnose,
          },
          signal,
          root,
        ).finally(() => (model !== coder ? this.switchModel(coder) : undefined));
        return diagnosisText(run.output);
      },
    };
  }

  /** Verdict de la mission à partir de la tâche de code. */
  private async finishFromTask(): Promise<void> {
    const mission = this.current;
    if (!mission) return;
    const task = this.host.currentTask();
    mission.taskId = task?.id ?? null;
    const verdict = task?.report?.verdict ?? (task?.status === 'refused' ? 'stopped' : 'failed');
    mission.verdict = verdict;
    mission.status =
      task?.status === 'refused' || task?.status === 'cancelled'
        ? 'cancelled'
        : verdict === 'success'
          ? 'finished'
          : 'failed';
    const failedNew =
      mission.kind === 'new-project' &&
      verdict !== 'success' &&
      task?.status !== 'refused';
    const lastFail =
      task?.failureReason ??
      task?.runs.at(-1)?.newFailures?.[0] ??
      task?.report?.markdown?.split('\n').find((l) => /échec|fail|error/i.test(l)) ??
      task?.repeatedFailure?.failures?.[0];
    mission.summary =
      task?.status === 'refused'
        ? 'Plan refusé : rien n’a été écrit.'
        : verdict === 'success'
          ? `Réussie : ${task?.diff.length ?? 0} fichier(s) modifié(s), tests et aperçu OK${task?.review ? ', revue sans point bloquant' : ''}.`
          : failedNew
            ? lastFail
              ? `Échec : ${lastFail}`
              : 'Échec : le programme demandé n’a pas été livré (gabarit non fusionné).'
            : lastFail
              ? `Échec : ${lastFail}`
              : 'Pas réussie : vois le rapport de la tâche.';
    if (task) {
      this.deps
        .recordModelRun?.({
          model: task.model,
          category: modelRunCategory('CODER', mission.kind),
          success: verdict === 'success',
        })
        ?.catch(() => undefined);
    }
    if (task && this.deps.manualStore) {
      const installed = (await this.deps.ollama().status()).models.map((m) => m.name);
      mission.learning = await this.deps.manualStore.tryLearningFromTask({
        settings: this.deps.settings(),
        installedModels: installed,
        missionKind: mission.kind,
        request: mission.request,
        model: task.model,
        templateId: this.project?.template,
        reportVerdict: task.report?.verdict ?? verdict,
        repeatedFailure: Boolean(task.repeatedFailure),
        reviewBlocking: task.review?.blocking ?? [],
        planSummary: task.plan?.summary ?? mission.request,
        filesTouched: task.diff.map((f) => f.path),
        testSuites: task.plan?.tests ?? [],
        runs: task.runs,
        checkpoint: task.checkpoints.at(-1)?.sha,
        now: this.now,
      });
    }
    this.activeRole = null;
    await this.persist();
  }
}
