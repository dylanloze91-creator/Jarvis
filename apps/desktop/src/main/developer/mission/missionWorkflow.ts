import {
  JARVIS_PROJECT_PROFILE,
  LOOP_ACTORS,
  MISSION_LABELS,
  MAX_GOAL_QUESTIONS,
  ROLE_LABELS,
  architectSchema,
  blockingIssues,
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
  goalPrompt,
  goalSchema,
  goalSystem,
  patchStep,
  randomId,
  resolveRoleModel,
  reviewPrompt,
  reviewSystem,
  reviewerSchema,
  rolesWithoutModel,
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
  parseNvidiaSmi,
} from '@jarvis/core';
import type {
  CodeTaskState,
  DevStepStatus,
  DevTaskKind,
  DeveloperState,
} from '../../../shared/developerIpc.js';
import { repoReader, runAsk } from '../ask/askFlow.js';
import { readGpuMemory } from '../models/hardwareProbe.js';
import type { OllamaApi } from '../models/ollamaApi.js';
import type { Runner } from '../runner.js';
import type { TaskHooks, TaskPhase } from '../task/taskRun.js';
import type { MissionStore } from './history.js';

type Step = (id: string, status: DevStepStatus, detail?: string) => void;

export interface MissionHost {
  runTask(
    kind: DevTaskKind,
    title: string,
    steps: ReadonlyArray<{ id: string; label: string }>,
    work: (step: Step, signal: AbortSignal) => Promise<string>,
  ): Promise<DeveloperState>;
  emit(): DeveloperState;
  notice(message: string): DeveloperState;
  repoRoot(): Promise<string | null>;
  /** Outils de lecture de la copie, inscrits au journal. */
  readTools(): Pick<ToolManager, 'schemas' | 'execute'>;
  pause(model: string, signal: AbortSignal): Promise<void>;
  /** Boucle de modification existante (plan → validation → copie isolée → tests → corrections). */
  startTask(request: string, options: { model: string; hooks: TaskHooks }): Promise<DeveloperState>;
  currentTask(): CodeTaskState | null;
}

export interface MissionDeps {
  registry: ProviderRegistry;
  ollama(): OllamaApi;
  run: Runner;
  settings(): Settings;
  modelOptions(model: string): OllamaCodeOptions;
  store: MissionStore;
  now?(): number;
}

export const MISSION_PROJECT_ID = JARVIS_PROJECT_PROFILE.id;

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
 * Missions sur Jarvis : objectif et questions (REASONER), conception
 * (ARCHITECT, DEBUGGER ou DOCUMENTATION), puis la boucle de modification
 * existante, avec REVIEWER et DEBUGGER branchés dessus. Le routeur est fait
 * de règles fixes ; chaque rôle prend le modèle choisi par l'utilisateur.
 */
export class MissionWorkflow {
  private current: MissionState | null = null;
  private history: MissionSummary[] | null = null;
  private lastModel: string | null = null;
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

  view(): Pick<DeveloperState, 'mission' | 'missions'> {
    return { mission: this.current, missions: this.history };
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
    return resolveRoleModel(role, this.developer())!;
  }

  private async persist(): Promise<void> {
    if (!this.current) return;
    this.current.updatedAt = this.now;
    await this.deps.store.save(this.current);
    this.history = await this.deps.store.list(this.current.projectId);
    this.host.emit();
  }

  private patch(id: string, patch: Partial<MissionStep>): void {
    if (this.current) patchStep(this.current, id, patch, this.now);
    void this.persist();
  }

  /** Un seul gros modèle chargé : le précédent est libéré quand un rôle change de modèle. */
  private async switchModel(model: string): Promise<void> {
    if (this.lastModel && this.lastModel !== model) await this.deps.ollama().unload(this.lastModel);
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

  async listMissions(): Promise<DeveloperState> {
    this.history = await this.deps.store.list(MISSION_PROJECT_ID);
    return this.host.emit();
  }

  async openMission(id: string): Promise<DeveloperState> {
    if (this.current && (this.current.status === 'running' || this.current.status === 'task'))
      return this.host.notice('Une mission est en cours : attends sa fin ou annule-la.');
    const mission = await this.deps.store.load(MISSION_PROJECT_ID, id);
    if (!mission) return this.host.notice('Mission introuvable.');
    this.current = mission;
    return this.host.emit();
  }

  async start(kind: MissionKind, request: string, skipQuestions: boolean): Promise<DeveloperState> {
    const text = request.trim();
    if (text.length < (kind === 'question' ? 4 : 8))
      return this.host.notice('Décris la mission en une phrase au moins.');
    if (text.length > 2_000)
      return this.host.notice('Demande trop longue (2 000 caractères au plus).');
    const missing = rolesWithoutModel(kind, this.developer());
    if (missing.length)
      return this.host.notice(
        `Aucun modèle pour : ${missing.map((r) => ROLE_LABELS[r]).join(', ')}. Choisis un modèle de code, ou un modèle par rôle (onglet Modèle de code). Aucun n’est choisi d’avance.`,
      );
    const status = await this.deps.ollama().status();
    const installed = new Set(status.models.map((m) => m.name));
    const needed = new Set(
      (
        [
          'REASONER',
          'ARCHITECT',
          'DEBUGGER',
          'DOCUMENTATION',
          ...Object.values(LOOP_ACTORS),
        ] as SpecialistRole[]
      ).map((role) => resolveRoleModel(role, this.developer())),
    );
    const absent = [...needed].filter((m): m is string => Boolean(m) && !installed.has(m!));
    if (absent.length)
      return this.host.notice(
        `Modèle absent d’Ollama : ${absent.join(', ')}. Rien n’est téléchargé.`,
      );
    const root = await this.host.repoRoot();
    if (!root)
      return this.host.notice(
        'Choisis et vérifie d’abord la copie de travail (Réglages → Développeur).',
      );
    this.current = createMission({
      id: `${new Date(this.now).toISOString().slice(0, 10)}-${randomId().slice(0, 8)}`,
      projectId: MISSION_PROJECT_ID,
      kind,
      request: text,
      skipQuestions,
      now: this.now,
    });
    this.counters.clear();
    this.open.clear();
    await this.persist();
    if (kind === 'question') return this.answerQuestion(root);
    const state = await this.goalPhase(root);
    if (this.current.status !== 'running') return state;
    return this.designAndTask(root);
  }

  /** Réponses de l'utilisateur aux questions de l'objectif ; vides = continuer sans répondre. */
  async answer(answers: string[]): Promise<DeveloperState> {
    const mission = this.current;
    if (!mission || mission.status !== 'waiting-answers')
      return this.host.notice('Aucune mission n’attend de réponse.');
    const root = await this.host.repoRoot();
    if (!root) return this.host.notice('Choisis et vérifie d’abord la copie de travail.');
    mission.answers = (mission.goal?.questions ?? []).map((question, i) => ({
      question,
      answer: (answers[i] ?? '').slice(0, 1_000),
    }));
    mission.status = 'running';
    this.patch('goal', { status: 'done', detail: 'réponses reçues' });
    return this.designAndTask(root);
  }

  private fail(message: string, signal?: AbortSignal): void {
    if (!this.current) return;
    this.current.status = signal?.aborted ? 'cancelled' : 'failed';
    this.current.verdict = 'stopped';
    this.current.summary = message;
    void this.persist();
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
              tools: this.host.readTools(),
              read: repoReader(root),
              profile: JARVIS_PROJECT_PROFILE,
              signal,
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
        step('goal', 'running');
        try {
          const run = await this.specialist(
            'goal',
            'REASONER',
            {
              system: goalSystem(
                JARVIS_PROJECT_PROFILE,
                mission.skipQuestions ? 0 : MAX_GOAL_QUESTIONS,
              ),
              prompt: goalPrompt(mission.request),
              schema: goalSchema,
            },
            signal,
            root,
          );
          const goal = {
            ...run.output,
            questions: mission.skipQuestions
              ? []
              : run.output.questions.slice(0, MAX_GOAL_QUESTIONS),
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
    return { request: mission.request, goal: mission.goal, answers: mission.answers };
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
          const run = await this.specialist<ArchitectOutput | DebuggerOutput | DocumentationOutput>(
            'design',
            role,
            {
              system: designSystem(role, JARVIS_PROJECT_PROFILE),
              prompt: designPrompt(this.brief()),
              schema: schema as never,
              tools: this.host.readTools(),
              maxRounds: 10,
            },
            signal,
            root,
          );
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
      hooks: this.loopHooks(root, coder, context),
    });
    await this.finishFromTask();
    return this.host.emit();
  }

  private loopHooks(root: string, coder: string, planContext: string): TaskHooks {
    const onPhase: TaskHooks['onPhase'] = (phase, status, detail, extra) => {
      const mission = this.current;
      if (!mission) return;
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
        void this.persist();
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
    return {
      planContext,
      docsOnly: this.current?.kind === 'document',
      onPhase,
      review: async (diff, signal) => {
        const model = this.modelFor('REVIEWER');
        const id = this.open.get('review')!;
        const run = await this.specialist(
          id,
          'REVIEWER',
          {
            system: reviewSystem(JARVIS_PROJECT_PROFILE),
            prompt: reviewPrompt(diff, brief),
            schema: reviewerSchema,
          },
          signal,
          root,
        ).finally(() => (model !== coder ? this.switchModel(coder) : undefined));
        const blocking = blockingIssues(run.output);
        return {
          blocking,
          model,
          summary: `verdict « ${run.output.verdict} », ${run.output.issues.length} remarque(s)${blocking.length ? `, ${blocking.length} bloquante(s)` : ''}`,
        };
      },
      diagnose: async (failures, excerpts, signal, tools) => {
        const model = this.modelFor('DEBUGGER');
        const id = this.open.get('diagnose')!;
        const run = await this.specialist(
          id,
          'DEBUGGER',
          {
            system: diagnoseSystem(JARVIS_PROJECT_PROFILE),
            prompt: diagnosePrompt(failures, excerpts),
            schema: debuggerSchema,
            tools,
            maxRounds: 6,
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
    mission.summary =
      task?.status === 'refused'
        ? 'Plan refusé : rien n’a été écrit.'
        : verdict === 'success'
          ? `Réussie : ${task?.diff.length ?? 0} fichier(s) modifié(s) dans la copie isolée, tests sans nouvel échec${task?.review ? ', revue sans point bloquant' : ''}.`
          : 'Pas réussie : vois le rapport de la tâche.';
    this.activeRole = null;
    await this.persist();
  }
}
