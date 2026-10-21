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
  DESKTOP_WINDOWS_EXE,
  isDotnetWindowsDesktopTemplate,
  developerAgentStarted,
  developerStepSentence,
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
  experienceFromMission,
  experienceAttempt,
  experienceReplacement,
  type LearningRecord,
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
  briefWithoutTrademark,
  isPlatformerRequest,
  isWeakProjectName,
  chooseCreationCoder,
  projectNameFromRequest,
  projectNameNeedsQuestion,
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
import { claimAgent, haltDependents } from './agentLifecycle.js';
import {
  TEMPLATE_STILL_LINE,
  gameFolderWritten,
  isJournalLock,
  journalOutcomeLine,
  levelDelivered,
  type MissionStore,
} from './history.js';
import { ModelSwitchError, createModelSwitch } from './modelSwitch.js';

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
  /** Ouvre l’aperçu du jeu dès que le niveau est vraiment écrit. */
  openProjectPreview?(project: ResolvedProject): Promise<boolean>;
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
  /** Fiches validées déjà en mémoire, seulement celles qui recoupent la demande. */
  learningRecall?: (query: string) => Promise<string>;
  /** Mêmes fiches, pour appliquer un indice dans les fichiers de CE projet. */
  learningRecords?: (query: string) => Promise<LearningRecord[]>;
  rememberLearning?: (record: LearningRecord) => Promise<void>;
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
  /** Un seul nouvel essai d’écriture si le gabarit est encore intact. */
  private levelRetried = false;
  /** Déchargements en série : un modèle à la fois, même après un délai. */
  private readonly modelSwitch = createModelSwitch();

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

  private gameFilesWritten(): boolean {
    return gameFolderWritten(this.project?.root);
  }

  private levelIsDelivered(): boolean {
    return levelDelivered(this.project?.root);
  }

  /** Une seule ligne de chat pour un verrou du journal. Le gabarit intact n’est pas un jeu. */
  private rememberJournal(savedInPlace: boolean): string {
    const mission = this.current!;
    const line = this.levelIsDelivered()
      ? journalOutcomeLine(true, savedInPlace)
      : this.gameFilesWritten()
        ? TEMPLATE_STILL_LINE
        : journalOutcomeLine(false, false);
    if (mission.journalNote !== line) {
      mission.journalNote = line;
      this.deps.onMissionChatLine?.(line);
    }
    return line;
  }

  private async persist(): Promise<void> {
    if (!this.current) return;
    this.current.updatedAt = this.now;
    let mode: 'renamed' | 'in-place' | 'lost' = 'renamed';
    try {
      mode = await this.deps.store.save(this.current);
    } catch (error) {
      if (!isJournalLock(error)) throw error;
      mode = 'lost';
    }
    if (mode !== 'renamed') {
      const delivered = this.levelIsDelivered();
      const line = delivered
        ? journalOutcomeLine(true, mode === 'in-place')
        : this.gameFilesWritten()
          ? TEMPLATE_STILL_LINE
          : journalOutcomeLine(false, false);
      const announce = this.current.journalNote !== line;
      this.current.journalNote = line;
      if (announce) this.deps.onMissionChatLine?.(line);
      if (announce && mode === 'in-place') {
        try {
          await this.deps.store.save(this.current);
        } catch (error) {
          if (!isJournalLock(error)) throw error;
        }
      }
      if (!delivered && !this.gameFilesWritten()) throw new Error(line);
    }
    this.historyProject = this.current.projectId;
    try {
      this.history = await this.deps.store.list(this.current.projectId);
    } catch {
      /* la liste peut manquer : la mission en mémoire reste valable */
    }
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

  private trace(
    step: string,
    status: 'start' | 'end' | 'error' | 'wait' | 'timeout' | 'cancel',
    extra: { agentId?: string; model?: string; error?: string; startedAt?: number } = {},
  ): void {
    const at = new Date(this.now).toISOString();
    const missionId = this.current?.id ?? '-';
    const durationMs =
      extra.startedAt !== undefined ? Math.max(0, this.now - extra.startedAt) : undefined;
    const line = [
      at,
      `mission=${missionId}`,
      extra.agentId ? `agent=${extra.agentId}` : '',
      `step=${step}`,
      extra.model ? `model=${extra.model}` : '',
      `status=${status}`,
      durationMs !== undefined ? `durationMs=${durationMs}` : '',
      extra.error ? `error=${extra.error.replace(/\s+/g, ' ').slice(0, 240)}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    this.deps.log?.(line);
  }

  private agent(
    id: string,
    patch: Partial<MissionAgentState> & { status?: MissionAgentStatus },
  ): void {
    const mission = this.current;
    if (!mission) return;
    mission.agents ??= [];
    const found = mission.agents.find((agent) => agent.id === id);
    if (!found) return;
    if (patch.status === 'running' && !claimAgent(found)) return;
    const previous = found.status;
    Object.assign(found, patch);
    if (patch.status === 'running' && previous === 'pending') {
      found.startedAt = this.now;
      this.trace('agent', 'start', { agentId: found.id, model: found.model });
    }
    if (patch.status && patch.status !== previous) {
      const line =
        patch.status === 'running'
          ? `${found.name} : en cours.`
          : patch.status === 'done' || patch.status === 'failed' || patch.status === 'cancelled'
            ? developerStepSentence({
                name: found.name,
                status: patch.status,
                detail: found.detail,
                files: found.files,
                error: found.error,
              })
            : '';
      if (line) this.deps.onMissionChatLine?.(line);
    }
    if (
      (patch.status === 'done' || patch.status === 'failed' || patch.status === 'cancelled') &&
      found.finishedAt === undefined
    ) {
      found.finishedAt = this.now;
      this.trace(
        'agent',
        patch.status === 'cancelled' ? 'cancel' : patch.status === 'failed' ? 'error' : 'end',
        {
          agentId: found.id,
          model: found.model,
          error: found.error,
          startedAt: found.startedAt,
        },
      );
    }
    mission.updatedAt = this.now;
    this.persistLater();
  }

  /** Ferme les agents encore ouverts. `done` n’est jamais posé ici : il faut un résultat vérifiable. */
  private closeOpenAgents(message: string, mode: 'failed' | 'cancelled'): void {
    const mission = this.current;
    if (!mission?.agents?.length) return;
    const seed = mission.agents.find((agent) => agent.status === 'failed')?.id;
    let agents = mission.agents;
    if (seed) agents = haltDependents(agents, seed, message, mode);
    mission.agents = agents.map((agent) => {
      if (agent.status !== 'pending' && agent.status !== 'running') return agent;
      const label = mode === 'failed' ? 'échec' : 'annulé';
      this.deps.onMissionChatLine?.(
        `${agent.name} : ${label}. ${message.replace(/\s+/g, ' ').slice(0, 160)}`,
      );
      return {
        ...agent,
        status: mode,
        error: (agent.error ?? message).slice(0, 300),
        finishedAt: agent.finishedAt ?? this.now,
      };
    });
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

  /**
   * Un seul modèle Ollama chargé. 20 s pour la liste et chaque déchargement.
   * `lastModel` n’est posé qu’après la vérification. Un délai n’est pas retenté :
   * la requête sous-jacente peut encore tourner.
   */
  private async switchModel(model: string): Promise<void> {
    const started = this.now;
    this.trace('ollama', 'start', { model, startedAt: started });
    const once = () =>
      this.modelSwitch.switchTo({
        api: this.deps.ollama(),
        model,
        log: (line) => this.deps.log?.(line),
      });
    try {
      await once();
    } catch (error) {
      const recoverable = error instanceof ModelSwitchError && error.kind === 'call';
      const message = error instanceof Error ? error.message : String(error);
      this.trace('ollama', error instanceof ModelSwitchError && error.kind === 'timeout' ? 'timeout' : 'error', {
        model,
        error: message,
        startedAt: started,
      });
      if (!recoverable) throw error;
      this.trace('ollama', 'wait', { model, error: 'nouvel essai après une erreur de contact' });
      await once();
    }
    this.lastModel = model;
    this.trace('ollama', 'end', { model, startedAt: started });
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
    let text = briefWithoutTrademark(request);
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
    const developer = this.developer();
    const selectedCoder = plan.get('CODER')?.model ?? developer.codeModel.trim();
    const creationCoder =
      kind === 'new-project' || kind === 'modify' || kind === 'fix' || kind === 'skill'
        ? chooseCreationCoder({
            selected: selectedCoder,
            chatModel: developer.chatModel,
            installed,
            parameterSize: (name) => status.models.find((model) => model.name === name)?.parameterSize,
          })
        : { model: selectedCoder, pull: null, reason: '' };
    const coder = creationCoder.model;
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
    const pickedCoder = chatExtras?.coderOverride;
    const override = pickedCoder?.model.trim() ?? '';
    if (pickedCoder && override && installed.has(override)) {
      this.current.coderOverride = { model: override, reason: pickedCoder.reason };
    }
    if (chatExtras?.projectDecisions?.length)
      this.current.projectDecisions = chatExtras.projectDecisions.slice(0, 40);
    if (creationCoder.reason && creationCoder.model !== this.current.coderOverride?.model) {
      this.current.coderOverride = { model: creationCoder.model, reason: creationCoder.reason };
      this.deps.log?.(`[modèles] ${creationCoder.reason}`);
      this.deps.onMissionChatLine?.(creationCoder.reason);
    }
    this.counters.clear();
    this.open.clear();
    this.levelRetried = false;
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
    if (signal?.aborted) {
      this.current.status = 'cancelled';
      this.current.verdict = 'stopped';
      this.current.summary = message;
      this.closeOpenAgents(message, 'cancelled');
      this.trace('mission', 'cancel', { error: message });
      this.persistLater();
      return;
    }
    if (isJournalLock(message)) {
      const delivered = this.levelIsDelivered();
      if (!delivered) {
        const line = this.gameFilesWritten() ? TEMPLATE_STILL_LINE : journalOutcomeLine(false, false);
        if (this.current.journalNote !== line) {
          this.current.journalNote = line;
          this.deps.onMissionChatLine?.(line);
        }
        if (!this.gameFilesWritten()) {
          this.current.status = 'failed';
          this.current.verdict = 'stopped';
          this.current.summary = line;
          this.closeOpenAgents(line, 'failed');
          this.trace('mission', 'end', { error: line });
        }
        this.persistLater();
        return;
      }
      const keep =
        this.current.verdict === 'success' || this.current.status === 'finished';
      if (keep || this.current.verdict === 'failed') {
        if (!this.current.journalNote?.startsWith('Jeu écrit')) this.rememberJournal(false);
        if (keep) {
          this.current.status = 'finished';
          this.current.verdict = 'success';
        }
        this.persistLater();
        return;
      }
      const told = Boolean(this.current.journalNote);
      message = this.current.journalNote?.startsWith('Le jeu')
        ? this.current.journalNote
        : journalOutcomeLine(false, false);
      this.current.journalNote = message;
      this.current.status = 'failed';
      this.current.verdict = 'stopped';
      this.current.summary = message;
      this.closeOpenAgents(message, 'failed');
      this.trace('mission', 'end', { error: message });
      if (!told) this.deps.onMissionChatLine?.(developerMissionFailureLine(message));
      this.persistLater();
      return;
    }
    this.current.status = 'failed';
    this.current.verdict = 'stopped';
    this.current.summary = message;
    this.closeOpenAgents(message, 'failed');
    this.trace('mission', 'end', { error: message });
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
              if (!(error instanceof SpecialistError) || signal.aborted) {
                const message = error instanceof Error ? error.message : String(error);
                this.agent('supervisor', { status: 'failed', error: message.slice(0, 300) });
                throw error;
              }
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
            return summary ?? null;
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
            developerStepSentence({
              name: 'Superviseur',
              status: 'done',
              detail: `${supervisorPlan.tasks.length} agent(s) créé(s) selon la demande`,
            }),
          );
          if (typeof scaffoldOutcome === 'string') {
            this.setAgentRole('préparation', 'failed', scaffoldOutcome, { error: scaffoldOutcome });
            this.patch('scaffold', { status: 'failed', detail: scaffoldOutcome });
            step('scaffold', 'failed', scaffoldOutcome);
            throw new Error(scaffoldOutcome);
          }
          const fromScope = mission.projectId;
          mission.projectId = scaffoldOutcome.projectId;
          // Avant le déplacement du journal : la phrase du Superviseur est déjà en file,
          // et ce déplacement rend la main. Le chat doit connaître le dossier avant ça.
          this.deps.onMissionFocusProject?.(scaffoldOutcome.projectId);
          if (fromScope !== mission.projectId) await this.deps.store.move(mission, fromScope);
          this.patch('scaffold', { status: 'done', detail: scaffoldOutcome.path });
          this.trace('folder', 'end', { agentId: 'prepare' });
          this.setAgentRole(
            'préparation',
            'done',
            scaffoldOutcome.alreadyThere
              ? `déjà là ${scaffoldOutcome.path}`
              : scaffoldOutcome.path,
          );
          step('scaffold', 'done', scaffoldOutcome.path);
          if (webSummary) {
            this.patch('web-research', { status: 'done', detail: webSummary.chatLine.slice(0, 160) });
            step('web-research', 'done', webSummary.chatLine.slice(0, 80));
            mission.discussionContext = `${mission.discussionContext ?? ''}\n\n${webSummary.coderBlock}\n\n${webSummary.chatLine}`.slice(
              0,
              24_000,
            );
            this.setAgentRole('recherche', 'done', webSummary.chatLine.slice(0, 200));
            if (!this.agentByRole('recherche')) {
              this.deps.onMissionChatLine?.(
                developerStepSentence({
                  name: 'Recherche',
                  status: 'done',
                  detail: webSummary.chatLine.replace(/^Recherche web : /, '').slice(0, 140),
                }),
              );
            }
          } else {
            this.patch('web-research', { status: 'skipped', detail: 'recherche web indisponible' });
            step('web-research', 'done', 'sans résultat exploitable');
            const detail = 'aucune source exploitable, je continue avec le gabarit';
            this.setAgentRole('recherche', 'done', detail);
            if (!this.agentByRole('recherche')) {
              this.deps.onMissionChatLine?.(
                developerStepSentence({ name: 'Recherche', status: 'done', detail }),
              );
            }
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

  private async learningContext(query: string): Promise<string> {
    try {
      return (await this.deps.learningRecall?.(query)) ?? '';
    } catch {
      return '';
    }
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
              this.setAgentRole(
                'architecture',
                'done',
                `${PROJECT_TEMPLATES[chosen.template].label} · ${chosen.name}`,
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
          const reuseEntryId =
            mission.kind === 'new-project' && mission.projectId !== NEW_PROJECT_SCOPE
              ? mission.projectId
              : undefined;
          if (!skill && isWeakProjectName(input.name)) {
            const decided = projectNameFromRequest(mission.request);
            if (!isWeakProjectName(decided)) input = { ...input, name: decided };
          }
          const nameQuestion = projectNameNeedsQuestion(mission.request);
          const asked = mission.answers.some((item) => item.question === nameQuestion);
          if (!skill && !reuseEntryId && nameQuestion && !asked && isWeakProjectName(input.name)) {
            mission.goal = {
              ...(mission.goal ?? {
                goal: mission.request,
                questions: [],
                criteria: [],
                constraints: [],
              }),
              questions: [nameQuestion],
            };
            mission.status = 'waiting-answers';
            this.trace('mission', 'wait', { error: nameQuestion });
            await this.persist();
            return nameQuestion;
          }
          const chosenName = mission.answers
            .find((item) => item.question === nameQuestion)
            ?.answer.trim();
          if (chosenName && isWeakProjectName(input.name)) {
            input = { ...input, name: chosenName.slice(0, 60) };
          }
          result.template = input.template;
          this.patch('create', { status: 'waiting', detail: 'ta confirmation' });
          const from = mission.projectId;
          try {
            if (reuseEntryId) {
              const existing = await this.deps.projects.resolve(reuseEntryId);
              if (typeof existing !== 'string' && existing.origin !== 'workspace') {
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
          this.project = project;
          try {
            await this.deps.store.move(mission, from);
            await this.persist();
          } catch (error) {
            if (!isJournalLock(error) || !gameFolderWritten(project.root)) throw error;
            if (!mission.journalNote) {
              mission.journalNote = journalOutcomeLine(true, false);
              this.deps.onMissionChatLine?.(mission.journalNote);
            }
          }
          return `Projet créé : ${project.root}.`;
        } catch (error) {
          if (mission.status === 'running')
            this.fail(error instanceof Error ? error.message : String(error), signal);
          throw error;
        }
      },
    );
    const { project, template, design, research } = result;
    if (mission.status === 'waiting-answers') return done;
    if (!project || mission.status !== 'running') {
      if (mission.status === 'running' || mission.status === 'task') {
        const line = mission.summary ?? 'La mission s’est arrêtée avant le code.';
        mission.status = 'failed';
        mission.verdict = 'stopped';
        mission.summary = line;
        this.closeOpenAgents(line, 'failed');
        this.trace('mission', 'end', { error: line });
        this.persistLater();
      }
      return done;
    }
    this.project = project;
    mission.status = 'task';
    await this.persist();
    try {
    const coder = this.modelFor('CODER');
    const codeAgents = (mission.agents ?? []).filter((agent) => agent.role === 'code');
    this.trace('code-prep', 'start', { model: coder, agentId: codeAgents[0]?.id });
    const readyCodeAgents: typeof codeAgents = [];
    for (const agent of codeAgents) {
      const blocked = agent.dependsOn.some((id) => {
        const dep = mission.agents?.find((item) => item.id === id);
        return dep !== undefined && dep.status !== 'done';
      });
      if (blocked) {
        this.agent(agent.id, {
          status: 'failed',
          error: 'Une dépendance n’est pas terminée.',
          model: coder,
        });
        mission.agents = haltDependents(
          mission.agents ?? [],
          agent.id,
          'Une dépendance n’est pas terminée.',
          'failed',
        );
        continue;
      }
      this.agent(agent.id, {
        status: 'running',
        model: coder,
        detail: 'préparation du modèle',
      });
      readyCodeAgents.push(mission.agents?.find((item) => item.id === agent.id) ?? agent);
    }
    let modelReady = false;
    let modelError = '';
    for (let attempt = 0; attempt < 2 && !modelReady; attempt++) {
      try {
        await this.switchModel(coder);
        modelReady = true;
      } catch (error) {
        modelError = error instanceof Error ? error.message : String(error);
        this.deps.onMissionChatLine?.(`Préparation du modèle ${coder} : échec. ${modelError}`);
        if (attempt === 0) {
          this.deps.onMissionChatLine?.('Nouvel essai de la préparation du modèle.');
          continue;
        }
      }
    }
    if (!modelReady) {
      const line = `Le codeur n’a pas démarré : ${modelError}`;
      for (const agent of readyCodeAgents) {
        this.agent(agent.id, { status: 'failed', error: modelError, model: coder });
      }
      mission.status = 'failed';
      mission.verdict = 'stopped';
      mission.summary = line;
      this.closeOpenAgents(line, 'failed');
      this.trace('mission', 'end', { model: coder, error: line });
      this.persistLater();
      return this.host.emit();
    }
    for (const agent of readyCodeAgents) {
      const current = mission.agents?.find((item) => item.id === agent.id);
      if (current && current.status === 'running') {
        current.detail = current.brief;
      }
    }
    this.trace('code-prep', 'end', { model: coder, agentId: codeAgents[0]?.id });
    if (
      codeAgents.length > 0 &&
      codeAgents.every((agent) => agent.status === 'failed' || agent.status === 'cancelled')
    ) {
      const line = 'Le codeur n’a pas démarré : une dépendance a échoué.';
      mission.status = 'failed';
      mission.verdict = 'stopped';
      mission.summary = line;
      this.closeOpenAgents(line, 'failed');
      this.trace('mission', 'end', { error: line });
      this.persistLater();
      return this.host.emit();
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
      await this.learningContext(mission.request),
    ].join('\n');
    const fallbackPlan = template ? templatePlan(template, mission.request, project.name) : null;
    const platformer = template === 'web-game' && isPlatformerRequest(mission.request);
    const taskOptions = {
      model: coder,
      templateId: template ?? undefined,
      hooks: {
        ...this.loopHooks(project.root, coder, this.enrichedPlanContext(context)),
        ...(fallbackPlan ? { fallbackPlan } : {}),
        // Plateforme : seulement le niveau, un appel par fichier. Le reste passe par la boucle d’outils.
        ...(platformer
          ? {
              fileByFile: {
                references: ['src/level.ts'],
                guide: [
                  template ? TEMPLATE_GUIDES[template] : undefined,
                  design ? skillTaskContext(design, research) : undefined,
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
            }
          : {}),
      },
      project: {
        id: project.id,
        root: project.root,
        profile: project.profile,
        templateId: template ?? undefined,
      },
    };
    let merged = false;
    for (let pass = 0; pass < (platformer ? 2 : 1); pass++) {
      if (pass === 1) {
        if (this.levelIsDelivered()) break;
        if (mission.verdict === 'failed' || mission.verdict === 'stopped') break;
        this.levelRetried = true;
        mission.status = 'task';
        mission.verdict = null;
        mission.journalNote = TEMPLATE_STILL_LINE;
        this.deps.onMissionChatLine?.(TEMPLATE_STILL_LINE);
      }
      const request =
        pass === 0
          ? mission.request
          : `${mission.request}\n\n${TEMPLATE_STILL_LINE} Remplace PLAY_LEVEL dans src/level.ts : le niveau tutoriel ne compte pas.`;
      try {
        this.trace('dev-task', 'start', { model: coder, agentId: codeAgents[0]?.id });
        await this.host.startTask(request, taskOptions);
        this.trace('dev-task', 'end', { model: coder, agentId: codeAgents[0]?.id });
        await this.finishFromTask();
      } catch (error) {
        if (this.levelIsDelivered() || pass === 1 || !platformer) throw error;
        continue;
      }
      merged = false;
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
      const stopped = mission.verdict === 'failed' || mission.verdict === 'stopped';
      const levelMissing = platformer && !this.levelIsDelivered();
      if (levelMissing && !stopped && pass === 0) continue;
      if (stopped) {
        for (const agent of codeAgents.filter((agent) => agent.status !== 'done')) {
          this.agent(agent.id, {
            status: 'failed',
            error: mission.summary?.slice(0, 300) ?? 'le fichier n’a pas changé',
            files: [],
          });
        }
      }
      if (!levelMissing && mission.verdict === 'success' && merged && project) {
        this.deps.onMissionFocusProject?.(project.id);
        this.setAgentRole('package', 'running', 'prépare le livrable et le raccourci Bureau');
        await this.deliverWindowsExeIfRequested(template ?? undefined, mission.request, mission.projectId!);
        const shortcut = await this.host.deliverDesktopShortcut?.(project, mission.request);
        if (shortcut) this.deps.onMissionChatLine?.(`Raccourci bureau : ${shortcut}`);
        this.trace('deliverable', shortcut ? 'end' : 'error', {
          agentId: this.agentByRole('package')?.id,
          error: shortcut ? undefined : 'Aucun raccourci n’a pu être créé.',
        });
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
      break;
    }
    const stoppedAfter = mission.verdict === 'failed' || mission.verdict === 'stopped';
    if (platformer && project && !this.levelIsDelivered() && !stoppedAfter) {
      mission.status = 'failed';
      mission.verdict = 'failed';
      mission.summary = TEMPLATE_STILL_LINE;
      mission.journalNote = TEMPLATE_STILL_LINE;
      this.closeOpenAgents(TEMPLATE_STILL_LINE, 'failed');
      this.trace('mission', 'end', { error: TEMPLATE_STILL_LINE });
    } else if (project && this.levelIsDelivered() && mission.verdict === 'success') {
      try {
        await this.host.openProjectPreview?.(project);
      } catch {
        /* L’aperçu Electron peut manquer ici : le jeu écrit reste livré. */
      }
    }
    return this.host.emit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const journal = isJournalLock(error);
      const keep =
        journal &&
        this.levelIsDelivered() &&
        (this.current?.verdict === 'success' || this.current?.status === 'finished');
      if (!keep) {
        const text = journal
          ? this.gameFilesWritten()
            ? TEMPLATE_STILL_LINE
            : journalOutcomeLine(false, false)
          : message;
        this.setAgentRole('package', 'failed', text, { error: text });
        this.fail(text);
      } else {
        this.fail(message);
      }
      if (this.current && (this.current.status === 'running' || this.current.status === 'task')) {
        const text = this.current.summary ?? message;
        this.current.status = 'failed';
        this.current.verdict = 'stopped';
        this.current.summary = text;
        this.closeOpenAgents(text, 'failed');
        this.trace('mission', 'end', { error: text });
        this.persistLater();
      }
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
          this.trace('tests', 'start', { agentId: this.agentByRole('test')?.id });
        } else if (status === 'done') {
          this.setAgentRole('test', 'done', detail ?? 'tests et lancement réussis');
          this.trace('tests', 'end', { agentId: this.agentByRole('test')?.id });
        } else {
          this.setAgentRole('test', 'failed', detail ?? 'vérification en échec', {
            error: detail ?? 'vérification en échec',
          });
          this.trace('tests', 'error', {
            agentId: this.agentByRole('test')?.id,
            error: detail ?? 'vérification en échec',
          });
        }
      }
      if (phase === 'edit' && status === 'done') {
        this.trace('files', 'end', { agentId: this.agentByRole('code')?.id });
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
      recallExperiences: this.deps.learningRecords
        ? (query) => this.deps.learningRecords!(query)
        : undefined,
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
      const replacement = experienceReplacement(task.diff);
      const errors = task.runs.flatMap((run) => run.newFailures).join('\n');
      const firstFailure = task.runs.find((run) => run.newFailures.length)?.newFailures[0] ?? '';
      const happened = lastFail ?? mission.summary ?? 'échec';
      if (mission.learning?.saved === true && verdict === 'success') {
        const experience = experienceFromMission({
          id: randomId(),
          now: this.now,
          ok: true,
          request: mission.request,
          errorSignature: errors,
          cause: firstFailure || mission.request,
          fix: replacement
            ? 'Indice : dans le fichier de ce projet, remplacer la ligne fautive. Ne pas recopier l’ancien fichier.'
            : (task.plan?.summary ?? mission.summary ?? mission.request),
          testCommands: task.plan?.tests ?? [],
          beforeResult: firstFailure,
          afterResult: 'contrôles passés',
          files: task.diff.map((file) => file.path),
          ...(replacement ? { hint: replacement } : {}),
          trace: {
            problem: mission.request,
            context: task.diff.map((file) => file.path).slice(0, 8).join(', '),
            firstTry: firstFailure,
            observedErrors: errors,
            appliedFix: replacement
              ? 'Remplacement local dans le fichier de ce projet.'
              : (task.plan?.summary ?? mission.request),
            testsRun: task.plan?.tests ?? [],
            finalResult: 'contrôles passés',
            limits:
              'Même langage seulement. Une autre version rend l’indice périmé. Le fichier d’origine n’est pas recopié.',
            language: replacement?.language ?? 'unknown',
            problemType: 'expérience',
            runtimeVersion: process.version,
            outcome: 'passed',
          },
        });
        if (experience) await this.deps.rememberLearning?.(experience);
      } else {
        const attempt = experienceAttempt({
          id: randomId(),
          now: this.now,
          request: mission.request,
          expected: 'les tests de ce projet passent',
          happened,
          likelyCause: firstFailure || happened,
          nextHypothesis: `Reprendre cet échec sans le valider : ${happened.slice(0, 180)}`,
          language: replacement?.language,
          testCommands: task.plan?.tests ?? [],
        });
        await this.deps.rememberLearning?.(attempt);
      }
    }
    this.activeRole = null;
    await this.persist();
  }
}
