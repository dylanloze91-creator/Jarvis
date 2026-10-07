import {
  ASK_TOOLS,
  JARVIS_PROJECT_PROFILE,
  buildAuditEntry,
  candidateRepoPaths,
  createCodeAIProvider,
  classifyCommand,
  missionRequestFromProjectChat,
  codeModelsOffered,
  isProjectChatDirectRequest,
  randomId,
  redactSecrets,
  resolveLocalOllamaBase,
  toolView,
  validateRepo,
  ToolManager as DevToolManager,
  type AuditLogStore,
  type MissionKind,
  type ProviderRegistry,
  type ConfirmationRequest,
  type RepoFacts,
  type SearchProviderRegistry,
  type Settings,
  type ToolCallOutcome,
  type ToolManager,
} from '@jarvis/core';
import { join } from 'node:path';
import { runProjectChatTurn, type ProjectChatSideEffects } from './project/projectChatFlow.js';
import { ProjectPreviewWindow } from './project/projectPreview.js';
import type { ProjectChatPersisted } from './project/projectChatStore.js';
import { createProjectChatTools } from './tools/projectChatTools.js';
import type {
  AskView,
  DevConfirmation,
  ProjectChatView,
  ProjectSimpleRun,
  DevStep,
  DevStepStatus,
  DevTask,
  DevTaskKind,
  DeveloperState,
} from '../../shared/developerIpc.js';
import { ANALYSIS_STEPS, analyzeArchitecture } from './analysis.js';
import { repoReader, runAsk } from './ask/askFlow.js';
import { MissionStore } from './mission/history.js';
import { MissionWorkflow } from './mission/missionWorkflow.js';
import { ProjectStore } from './project/projectStore.js';
import { ProjectsWorkflow, type ResolvedProject } from './project/projectsWorkflow.js';
import { measureFree, probeEnvironment, type EnvironmentProbe } from './environment.js';
import { detectRepo, gatherRepoFacts } from './repo.js';
import { runProcess, type Runner } from './runner.js';
import { createDeveloperToolManager } from './tools/index.js';
import { createReadTools } from './tools/readTools.js';
import { samePath } from './task/sandbox.js';
import { ollamaModelsDir } from './models/hardwareProbe.js';
import { createOllamaApi, type OllamaApi } from './models/ollamaApi.js';
import { patientFetch } from './models/patientFetch.js';
import { CodeModelStore } from './models/store.js';
import { CodeModelWorkflow, type WorkflowDeps } from './models/workflow.js';
import { ChatActivity } from './task/chatActivity.js';
import type { AskExtra, TaskHooks, TaskPhase, TaskPhaseStatus } from './task/taskRun.js';
import { DeveloperManualStore } from './knowledge/manualStore.js';
import { CodeTaskWorkflow } from './task/workflow.js';

export interface ControllerDeps {
  getSettings(): Settings;
  appVersion(): string;
  platform: NodeJS.Platform;
  home: string;
  logsDir(): string;
  oneDriveRoots(): string[];
  auditLog: AuditLogStore;
  emit(state: DeveloperState): void;
  run?: Runner;
  repoUrl?: string;
  now?(): Date;
  freeBytes?(path: string): Promise<number | null>;
  /** Registre des fournisseurs du chat, réutilisé pour le modèle de code (aucun nouveau client réseau). */
  registry: ProviderRegistry;
  /** Recherche web (discussion projet : une fois, avec confirmation). */
  searchRegistry: SearchProviderRegistry;
  userDataPath(): string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  system?: WorkflowDeps['system'];
  /** Tours de chat en cours (décision 5) : la tâche de code cède la place. */
  chat?: ChatActivity;
  chatGraceMs?: number;
}

export const DEVELOPER_DISABLED_NOTICE =
  'Le mode Développeur est coupé : active-le dans Réglages → Développeur.';
const MAX_LOG_LINES = 40;

function directRunIntent(phase: TaskPhase, status: TaskPhaseStatus, detail?: string): string {
  if (status === 'failed') return 'Un problème est survenu ; je m’arrête.';
  const labels: Record<TaskPhase, string> = {
    plan: 'Je lis le projet et je prépare les changements…',
    edit: 'J’écris le code…',
    test: 'Je vérifie que tout fonctionne…',
    review: 'Je relis le résultat…',
    diagnose: 'Je cherche la cause d’un souci…',
    fix: 'Je corrige…',
  };
  if (status === 'running' && detail?.trim()) return detail.trim();
  return labels[phase] ?? 'Je travaille sur ta demande…';
}

/**
 * Session de Jarvis Développeur, séparée du chat : son propre gestionnaire
 * d'outils, ses propres confirmations, son propre arrêt. Le chat n'en sait rien.
 */
export class DeveloperController {
  private readonly run: Runner;
  private readonly manager: ToolManager;
  private repoPath = '';
  private repoFacts: RepoFacts | null = null;
  private repo: DeveloperState['repo'] = null;
  private environment: EnvironmentProbe | null = null;
  private task: DevTask | null = null;
  private confirmation: DevConfirmation | null = null;
  private report: DeveloperState['report'] = null;
  private askView: AskView | null = null;
  private projectChat: ProjectChatView | null = null;
  private readonly projectPreview = new ProjectPreviewWindow();
  private notice: string | null = null;
  private controller: AbortController | null = null;
  private readonly pending = new Map<string, (approved: boolean) => void>();
  private readonly models: CodeModelWorkflow;
  private readonly tasks: CodeTaskWorkflow;
  private readonly manualStore: DeveloperManualStore;
  private readonly missions: MissionWorkflow;
  private readonly projects: ProjectsWorkflow;
  /** Outils de lecture d'un projet autre que Jarvis (0.5.3), un gestionnaire par dossier. */
  private readonly projectReaders = new Map<string, ToolManager>();
  private readonly env: Record<string, string | undefined>;

  private ollama(): OllamaApi {
    return createOllamaApi(resolveLocalOllamaBase(this.deps.getSettings()), this.deps.fetch);
  }

  constructor(private readonly deps: ControllerDeps) {
    this.run = deps.run ?? runProcess;
    this.env = deps.env ?? process.env;
    this.repoPath = deps.getSettings().developer.repoPath;
    const freeBytes = (path: string) => (deps.freeBytes ?? measureFree)(path);
    this.models = new CodeModelWorkflow(
      {
        runTask: (kind, title, steps, work) => this.runTask(kind, title, steps, work),
        callTool: (name, args, step, workStep) => this.callTool(name, args, step, workStep),
        emit: () => this.emit(),
        notice: (message) => {
          this.notice = message;
          return this.emit();
        },
        audit: (name, args, content) => {
          void deps.auditLog.append(
            buildAuditEntry({
              callId: randomId(),
              name,
              status: 'ok',
              content,
              arguments: args,
              decision: 'approved',
              durationMs: 0,
            }),
          );
        },
        repoRoot: async () => {
          const saved = deps.getSettings().developer.repoPath;
          if (!this.repo && saved) this.setRepo(await gatherRepoFacts(saved, this.run));
          return this.repo?.ok ? this.repoPath : null;
        },
        nodePath: async () => {
          if (!this.environment) await this.probe();
          return this.environment?.nodePath ?? null;
        },
        readTools: () => this.auditedReadTools(ASK_TOOLS),
        pause: (model, signal) => this.yieldToChat(model, signal),
      },
      {
        registry: deps.registry,
        run: this.run,
        ollama: () => this.ollama(),
        store: new CodeModelStore(() => join(deps.userDataPath(), 'developer', 'code-model.json')),
        home: deps.home,
        platform: deps.platform,
        env: this.env,
        freeBytes,
        benchDir: () => join(deps.userDataPath(), 'developer', 'bench'),
        chatModel: () =>
          deps.getSettings().provider === 'ollama' ? deps.getSettings().model : null,
        machineProfile: () => deps.getSettings().machine?.profile,
        system: deps.system,
      },
    );
    this.manager = createDeveloperToolManager({
      models: {
        ollama: () => this.ollama(),
        modelsDir: () => ollamaModelsDir(this.env, deps.home),
        freeBytes,
        pullAllowed: (modelId) => this.models.pullAllowed(modelId),
        onPullProgress: (modelId, status, completed, total) => {
          this.models.onPullProgress(modelId, status, completed, total);
          this.scheduleEmit();
        },
      },
      getRoot: () => (this.repo?.ok ? this.repoPath : null),
      run: this.run,
      logsDir: deps.logsDir,
      repoUrl: deps.repoUrl,
      getNode: async () => {
        if (!this.environment) await this.probe();
        return {
          nodePath: this.environment?.nodePath ?? null,
          npmCli: this.environment?.npmCli ?? null,
        };
      },
      freeBytes: (path) => (deps.freeBytes ?? measureFree)(path),
    });
    this.manualStore = new DeveloperManualStore({
      userDataPath: deps.userDataPath,
      fetchImpl: deps.fetch,
    });
    this.tasks = new CodeTaskWorkflow(
      {
        runTask: (kind, title, steps, work) => this.runTask(kind, title, steps, work),
        ask: (request, extra, signal) => this.askUser(request, signal, extra),
        emit: () => this.emit(),
        notice: (message) => {
          this.notice = message;
          return this.emit();
        },
        audit: (outcome, note) =>
          void deps.auditLog.append(
            buildAuditEntry(
              note ? { ...outcome, content: `${note}. ${outcome.content}` } : outcome,
              this.missions?.scope(),
            ),
          ),
        log: (line) => this.appendLog(line),
        node: async () => {
          if (!this.environment) await this.probe();
          const { nodePath, npmCli } = this.environment ?? { nodePath: null, npmCli: null };
          return nodePath && npmCli ? { nodePath, npmCli } : null;
        },
        readTools: (root) => this.auditedReadTools(undefined, root),
        repoRoot: () => this.jarvisRoot(),
      },
      {
        registry: deps.registry,
        run: this.run,
        ollama: () => this.ollama(),
        chat: deps.chat ?? new ChatActivity(),
        modelOptions: (model) => this.models.optionsFor(model),
        settings: () => deps.getSettings(),
        logsDir: deps.logsDir,
        freeBytes,
        graceMs: deps.chatGraceMs,
        manualStore: this.manualStore,
      },
    );
    this.projects = new ProjectsWorkflow(
      {
        runTask: (kind, title, steps, work) => this.runTask(kind, title, steps, work),
        ask: (request, extra, signal) => this.askUser(request, signal, extra),
        emit: () => this.emit(),
        notice: (message) => {
          this.notice = message;
          return this.emit();
        },
        audit: (outcome) =>
          void deps.auditLog.append(buildAuditEntry(outcome, this.missions?.scope())),
        log: (line) => this.appendLog(line),
        node: async () => {
          if (!this.environment) await this.probe();
          const { nodePath, npmCli } = this.environment ?? { nodePath: null, npmCli: null };
          return nodePath && npmCli ? { nodePath, npmCli } : null;
        },
        jarvisRoot: () => this.jarvisRoot(),
        jarvisChecks: () => this.repo?.checks ?? [],
      },
      {
        run: this.run,
        store: new ProjectStore(() => join(deps.userDataPath(), 'developer', 'projects')),
        settings: () => deps.getSettings(),
        home: deps.home,
        now: deps.now ? () => deps.now!().getTime() : undefined,
      },
    );
    this.missions = new MissionWorkflow(
      {
        runTask: (kind, title, steps, work) => this.runTask(kind, title, steps, work),
        emit: () => this.emit(),
        notice: (message) => {
          this.notice = message;
          return this.emit();
        },
        readTools: (root) => this.auditedReadTools(ASK_TOOLS, root),
        pause: (model, signal) => this.yieldToChat(model, signal),
        startTask: (request, options) => this.tasks.start(request, options),
        currentTask: () => this.tasks.view().codeTask,
      },
      {
        registry: deps.registry,
        ollama: () => this.ollama(),
        run: this.run,
        settings: () => deps.getSettings(),
        modelOptions: (model) => this.models.optionsFor(model),
        store: new MissionStore(() => join(deps.userDataPath(), 'developer', 'projects')),
        projects: this.projects,
        now: deps.now ? () => deps.now!().getTime() : undefined,
        realBenches: () => this.models.state().realBenches,
        manualStore: this.manualStore,
      },
    );
  }

  /** Copie de Jarvis vérifiée (revérifiée après un redémarrage), ou null. */
  private async jarvisRoot(): Promise<string | null> {
    const saved = this.deps.getSettings().developer.repoPath;
    if (!this.repo && saved) this.setRepo(await gatherRepoFacts(saved, this.run));
    return this.repo?.ok ? this.repoPath : null;
  }

  private readerFor(root: string | undefined): ToolManager {
    if (!root || (this.repoPath && samePath(root, this.repoPath))) return this.manager;
    let reader = this.projectReaders.get(root);
    if (!reader) {
      reader = new DevToolManager().registerAll(
        createReadTools({ getRoot: () => root, run: this.run, logsDir: this.deps.logsDir }),
      );
      this.projectReaders.set(root, reader);
    }
    return reader;
  }

  /** Lecture de la copie de l'utilisateur (ou d'un projet) : outils `safe`, inscrits au journal. */
  private auditedReadTools(
    names: readonly string[] = ['dev_read_file', 'dev_search_code', 'dev_search_files'],
    root?: string,
  ): Pick<ToolManager, 'schemas' | 'execute'> {
    const view = toolView(this.readerFor(root), names);
    return {
      schemas: () => view.schemas(),
      execute: async (call, context, events) => {
        const outcome = await view.execute(call, context, events);
        void this.deps.auditLog.append(buildAuditEntry(outcome, this.missions?.scope()));
        return outcome;
      },
    };
  }

  /** Pour les tests : jamais passé au chat. */
  tools(): ToolManager {
    return this.manager;
  }

  enabled(): boolean {
    return this.deps.getSettings().developer.enabled;
  }

  state(): DeveloperState {
    return {
      enabled: this.enabled(),
      suggestedPath: candidateRepoPaths({ platform: this.deps.platform, home: this.deps.home })[0]!,
      repoPath: this.repoPath,
      repo: this.repo,
      environment: this.environment
        ? { ok: this.environment.report.ok, checks: this.environment.report.checks }
        : null,
      task: this.task,
      confirmation: this.confirmation,
      report: this.report,
      model: this.models.state(),
      ...this.tasks.view(),
      busy: this.controller !== null,
      notice: this.notice,
      ask: this.askView,
      ...this.missions.view(),
      ...this.projects.view(),
      projectChat: this.projectChat,
    };
  }

  /** Décision 5 : la discussion garde la priorité, le modèle de code est libéré pendant son tour. */
  private async yieldToChat(model: string, signal: AbortSignal): Promise<void> {
    const chat = this.deps.chat;
    if (!chat?.busy) return;
    await this.ollama().unload(model);
    await chat.whenIdle(this.deps.chatGraceMs ?? 3_000, signal);
  }

  /** Question sur le code de la copie de travail : lecture seule, citations relues dans les fichiers. */
  async ask(question: string): Promise<DeveloperState> {
    const refused = this.guard(true);
    if (refused) return refused;
    const text = question.trim();
    if (text.length < 4) {
      this.notice = 'Pose une question d’au moins quelques mots.';
      return this.emit();
    }
    const model = this.deps.getSettings().developer.codeModel;
    if (!model) {
      this.notice =
        'Choisis d’abord un modèle de code (onglet « Modèle de code », étape 6) : aucun n’est choisi d’avance.';
      return this.emit();
    }
    const status = await this.ollama().status();
    if (!status.models.some((m) => m.name === model)) {
      this.notice = `Le modèle de code « ${model} » n’est pas installé dans Ollama.`;
      return this.emit();
    }
    const root = this.repoPath;
    return this.runTask(
      'ask',
      `Question : ${text.length > 60 ? `${text.slice(0, 57)}…` : text}`,
      [
        { id: 'model', label: 'Modèle de code' },
        { id: 'read', label: 'Lecture du dépôt (rien n’est modifié)' },
        { id: 'check', label: 'Citations relues dans les fichiers' },
      ],
      async (step, signal) => {
        step('model', 'done', model);
        step('read', 'running');
        const started = Date.now();
        const code = createCodeAIProvider(this.deps.registry, {
          model,
          baseUrl: this.ollama().baseUrl,
          options: this.models.optionsFor(model),
          fetch: patientFetch,
        });
        const result = await runAsk(
          {
            code,
            tools: this.auditedReadTools(ASK_TOOLS),
            read: repoReader(root),
            profile: JARVIS_PROJECT_PROFILE,
            signal,
            beforeRound: () => this.yieldToChat(model, signal),
          },
          text,
        );
        step('read', 'done', `${result.calls} lecture(s), ${result.rounds} tour(s)`);
        const { verified, citations } = result.checked;
        step(
          'check',
          verified > 0 ? 'done' : 'failed',
          `${verified}/${citations.length} citation(s) vérifiée(s)`,
        );
        this.askView = {
          question: text,
          model,
          at: Date.now(),
          durationMs: Date.now() - started,
          ...result,
        };
        return verified > 0
          ? 'Réponse prête, appuyée sur des extraits relus dans les fichiers.'
          : 'Réponse prête, mais aucune citation n’a pu être vérifiée : prends-la avec prudence.';
      },
    );
  }

  async startMission(
    kind: MissionKind,
    request: string,
    skipQuestions: boolean,
    projectId?: string,
  ): Promise<DeveloperState> {
    const needsJarvis = kind !== 'new-project' && (projectId ?? 'jarvis') === 'jarvis';
    return this.guard(needsJarvis) ?? this.missions.start(kind, request, skipQuestions, projectId);
  }

  async answerMission(answers: string[]): Promise<DeveloperState> {
    return this.guard(true) ?? this.missions.answer(answers);
  }

  async listMissions(projectId?: string): Promise<DeveloperState> {
    if (!this.enabled()) return this.guard() ?? this.state();
    return this.missions.listMissions(projectId);
  }

  async openMission(id: string, projectId?: string): Promise<DeveloperState> {
    return this.guard() ?? this.missions.openMission(id, projectId);
  }

  async startProposal(missionId: string, index: number, projectId: string): Promise<DeveloperState> {
    return (
      this.guard(projectId === 'jarvis') ?? this.missions.startProposal(missionId, index, projectId)
    );
  }

  async listProjects(): Promise<DeveloperState> {
    if (!this.enabled()) return this.guard() ?? this.state();
    return this.projects.list();
  }

  async importProject(path: string): Promise<DeveloperState> {
    return this.guard() ?? this.projects.import(path);
  }

  async forgetProject(id: string): Promise<DeveloperState> {
    return this.guard() ?? this.projects.forget(id);
  }

  async saveProjectMemory(id: string, notes: string): Promise<DeveloperState> {
    return this.guard() ?? this.projects.saveMemory(id, notes);
  }

  async buildProject(id: string): Promise<DeveloperState> {
    return this.guard() ?? this.projects.build(id);
  }

  private chatView(
    id: string,
    name: string,
    persisted: ProjectChatPersisted,
    previewOpen: boolean,
    run?: ProjectSimpleRun | null,
  ): ProjectChatView {
    const keepRun =
      run !== undefined
        ? run
        : this.projectChat?.projectId === id
          ? (this.projectChat.run ?? null)
          : null;
    return {
      projectId: id,
      projectName: name,
      messages: persisted.messages,
      decisions: persisted.decisions,
      codingPick: persisted.codingPick,
      webSearchUsed: persisted.webSearchUsed,
      compareOffer: persisted.compareOffer,
      previewOpen,
      run: keepRun,
    };
  }

  /** Modèle de code installé, sans demander à l’utilisateur (5.0.6). */
  private async ensureCodeModel(installed?: readonly string[]): Promise<string | null> {
    const names =
      installed ??
      (await this.ollama().status()).models.map((m) => m.name);
    const saved = this.deps.getSettings().developer.codeModel;
    if (saved && names.includes(saved)) return saved;
    const suggested = this.projectChat?.codingPick?.model;
    if (suggested && names.includes(suggested)) return suggested;
    const profile = this.deps.getSettings().machine?.profile;
    for (const spec of codeModelsOffered(profile)) {
      if (names.includes(spec.id)) return spec.id;
    }
    return names.find((n) => codeModelsOffered(profile).some((s) => s.id === n)) ?? null;
  }

  private mergeChatEffects(
    persisted: ProjectChatPersisted,
    effects: ProjectChatSideEffects,
    messages: ProjectChatView['messages'],
  ): ProjectChatPersisted {
    const decisions = [...persisted.decisions];
    for (const d of effects.decisions) {
      const text = d.trim();
      if (text && !decisions.includes(text)) decisions.push(text);
    }
    return {
      version: 2,
      messages,
      decisions: decisions.slice(0, 40),
      codingPick: effects.codingPick
        ? { model: effects.codingPick.model, reason: effects.codingPick.reason, at: Date.now() }
        : persisted.codingPick,
      webSearchUsed: persisted.webSearchUsed || effects.webSearchUsed,
      compareOffer: effects.compareOffer ?? persisted.compareOffer,
    };
  }

  async openProjectChat(projectId: string): Promise<DeveloperState> {
    if (!this.enabled()) return this.guard() ?? this.state();
    const id = projectId.trim();
    if (!id) {
      this.notice = 'Projet introuvable.';
      return this.emit();
    }
    const resolved = await this.projects.resolve(id);
    if (typeof resolved === 'string') {
      this.notice = resolved;
      return this.emit();
    }
    const persisted = await this.projects.loadChatState(id);
    const previewOpen = this.projectPreview.isOpen(id);
    this.projectChat = this.chatView(id, resolved.name, persisted, previewOpen);
    return this.emit();
  }

  async setProjectChatPreview(projectId: string, open: boolean): Promise<DeveloperState> {
    if (!this.enabled()) return this.guard() ?? this.state();
    const id = projectId.trim();
    const resolved = await this.projects.resolve(id);
    if (typeof resolved === 'string') {
      this.notice = resolved;
      return this.emit();
    }
    if (open) {
      const ok = this.projectPreview.open(id, resolved.root, resolved.template ?? null);
      if (!ok) {
        this.notice =
          'Aucun aperçu jouable : le projet doit avoir un index.html (gabarit jeu web ou page locale).';
      }
    } else this.projectPreview.close();
    const persisted = await this.projects.loadChatState(id);
    this.projectChat = this.chatView(id, resolved.name, persisted, this.projectPreview.isOpen(id));
    return this.emit();
  }

  async sendProjectChat(
    projectId: string,
    text: string,
    withScreenshot = false,
  ): Promise<DeveloperState> {
    const refused = this.guard(projectId === 'jarvis');
    if (refused) return refused;
    const id = projectId.trim();
    const userText = text.trim();
    if (userText.length < 2) {
      this.notice = 'Écris au moins quelques mots.';
      return this.emit();
    }
    const status = await this.ollama().status();
    const installed = status.models.map((m) => m.name);
    const model = await this.ensureCodeModel(installed);
    if (!model) {
      this.notice =
        'Jarvis n’a pas encore de modèle prêt pour ce projet. Vérifie qu’Ollama tourne avec un modèle de code installé.';
      return this.emit();
    }
    const resolved = await this.projects.resolve(id);
    if (typeof resolved === 'string') {
      this.notice = resolved;
      return this.emit();
    }
    const priorPersisted =
      this.projectChat?.projectId === id
        ? {
            version: 2 as const,
            messages: this.projectChat.messages,
            decisions: this.projectChat.decisions,
            codingPick: this.projectChat.codingPick,
            webSearchUsed: this.projectChat.webSearchUsed,
            compareOffer: this.projectChat.compareOffer,
          }
        : await this.projects.loadChatState(id);
    const now = Date.now();
    const userMsg = {
      id: randomId(),
      role: 'user' as const,
      content: userText,
      at: now,
      ...(withScreenshot ? { hasScreenshot: true } : {}),
    };
    const pendingMessages = [...priorPersisted.messages, userMsg];
    this.projectChat = this.chatView(
      id,
      resolved.name,
      { ...priorPersisted, messages: pendingMessages },
      this.projectPreview.isOpen(id),
    );
    await this.projects.saveChatState(id, { ...priorPersisted, messages: pendingMessages });
    if (isProjectChatDirectRequest(userText) && !withScreenshot) {
      return this.runProjectChatDirect(
        id,
        resolved,
        userText,
        priorPersisted,
        pendingMessages,
        model,
      );
    }
    let screenshotBase64: string | undefined;
    if (withScreenshot) {
      if (!this.projectPreview.isOpen(id)) {
        this.notice = 'Ouvre d’abord l’aperçu à côté du chat, puis envoie avec capture.';
        return this.emit();
      }
      const png = await this.projectPreview.capturePng();
      if (!png) {
        this.notice = 'Capture impossible : l’aperçu n’est pas prêt.';
        return this.emit();
      }
      await this.projects.saveChatScreenshot(id, userMsg.id, png);
      screenshotBase64 = png.toString('base64');
    }
    const effects: ProjectChatSideEffects = {
      decisions: [],
      webSearchUsed: priorPersisted.webSearchUsed,
    };
    const chatTools = createProjectChatTools({
      getSettings: () => this.deps.getSettings(),
      searchRegistry: this.deps.searchRegistry,
      installedModels: () => this.models.state().installedModels,
      onSuggestCoder: (picked, reason) => {
        effects.codingPick = { model: picked, reason };
      },
      onRememberDecision: (decision) => {
        effects.decisions.push(decision);
      },
      onOfferCompare: (alternateModel, reason) => {
        effects.compareOffer = { alternateModel, reason };
      },
      webSearchUsed: () => priorPersisted.webSearchUsed || effects.webSearchUsed,
      markWebSearchUsed: () => {
        effects.webSearchUsed = true;
      },
    });
    return this.runTask(
      'project-chat',
      `Discussion — ${resolved.name}`,
      [
        { id: 'model', label: 'Modèle de code' },
        { id: 'read', label: 'Lecture du projet (rien n’est modifié)' },
        { id: 'reply', label: 'Réponse' },
      ],
      async (step, signal) => {
        step('model', 'done', model);
        step('read', 'running');
        const code = createCodeAIProvider(this.deps.registry, {
          model,
          baseUrl: this.ollama().baseUrl,
          options: this.models.optionsFor(model),
          fetch: patientFetch,
        });
        const memory = await this.projects.memoryNotes(id);
        const history = priorPersisted.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const result = await runProjectChatTurn(
          {
            code,
            readTools: this.auditedReadTools(ASK_TOOLS, resolved.root),
            chatTools,
            profile: resolved.profile,
            memoryNotes: memory,
            decisions: priorPersisted.decisions,
            installedModels: installed,
            webSearchUsed: priorPersisted.webSearchUsed,
            history,
            signal,
            beforeRound: () => this.yieldToChat(model, signal),
            requestConfirmation: (request) => this.askUser(request, signal),
            screenshotBase64,
            effects,
          },
          userText,
        );
        step('read', 'done', `${result.calls} lecture(s), ${result.rounds} tour(s)`);
        step('reply', 'running');
        const assistant = {
          id: randomId(),
          role: 'assistant' as const,
          content: result.reply,
          at: Date.now(),
        };
        const nextMessages = [...pendingMessages, assistant];
        const merged = this.mergeChatEffects(priorPersisted, effects, nextMessages);
        await this.projects.saveChatState(id, merged);
        this.projectChat = this.chatView(
          id,
          resolved.name,
          merged,
          this.projectPreview.isOpen(id),
        );
        step('reply', 'done');
        return 'Réponse ajoutée à la discussion du projet.';
      },
    );
  }

  /** Demande claire → plan auto, copie isolée, tests, application au projet sans cartes intermédiaires. */
  private async runProjectChatDirect(
    id: string,
    resolved: ResolvedProject,
    userText: string,
    priorPersisted: ProjectChatPersisted,
    pendingMessages: ProjectChatView['messages'],
    model: string,
  ): Promise<DeveloperState> {
    let simpleRun: ProjectSimpleRun = {
      request: userText,
      phase: 'running',
      intent: 'Je prépare la modification…',
      result: null,
    };
    this.projectChat = this.chatView(
      id,
      resolved.name,
      { ...priorPersisted, messages: pendingMessages },
      this.projectPreview.isOpen(id),
      simpleRun,
    );
    this.emit();
    const { summary, discussionContext } = missionRequestFromProjectChat(
      pendingMessages,
      priorPersisted.decisions,
    );
    const planContext = [
      discussionContext,
      priorPersisted.decisions.length
        ? `Décisions : ${priorPersisted.decisions.join(' · ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const hooks: TaskHooks = {
      directRun: true,
      autoApprovePlan: true,
      planContext,
      onPhase: (phase, status, detail) => {
        if (this.projectChat?.projectId !== id) return;
        simpleRun = {
          ...simpleRun,
          intent: directRunIntent(phase, status, detail),
        };
        this.projectChat = {
          ...this.projectChat,
          run: simpleRun,
        };
        this.deps.emit(this.state());
      },
    };
    const started = await this.tasks.start(summary, {
      model,
      project: {
        id: resolved.id,
        root: resolved.root,
        profile: resolved.profile,
        templateId: resolved.template ?? undefined,
      },
      hooks,
    });
    const task = this.tasks.view().codeTask;
    const verdict = task?.report?.verdict;
    let applied = false;
    if (verdict === 'success') {
      const applyState = await this.tasks.applyDirectToProject();
      applied = Boolean(applyState.notice?.includes('Modification appliquée'));
      this.notice = applyState.notice;
    } else if (this.notice === null && task?.report) {
      this.notice =
        verdict === 'failed'
          ? 'Les vérifications n’ont pas réussi : ton projet n’a pas été modifié.'
          : null;
    }
    const ok = verdict === 'success' && applied;
    simpleRun = {
      ...simpleRun,
      phase: ok ? 'success' : 'failed',
      intent: ok ? 'Terminé.' : simpleRun.intent,
      result: ok
        ? 'La modification est dans ton projet. Tu peux réessayer ou demander autre chose.'
        : task?.report?.verdict === 'success' && !applied
          ? 'Les tests ont réussi mais la fusion a échoué ; ton projet n’a pas changé.'
          : 'Je n’ai pas pu finir cette fois. Reformule ou précise ta demande.',
    };
    const assistantText = ok
      ? `C’est fait : ${task?.plan?.summary ?? userText}\n\nTu peux tester dans l’aperçu ou me demander un autre changement.`
      : simpleRun.result!;
    const assistant = {
      id: randomId(),
      role: 'assistant' as const,
      content: assistantText,
      at: Date.now(),
    };
    const nextMessages = [...pendingMessages, assistant];
    const merged = this.mergeChatEffects(priorPersisted, { decisions: [], webSearchUsed: false }, nextMessages);
    await this.projects.saveChatState(id, merged);
    this.projectChat = this.chatView(
      id,
      resolved.name,
      merged,
      this.projectPreview.isOpen(id),
      simpleRun,
    );
    void started;
    return this.emit();
  }

  async startMissionFromChat(projectId: string): Promise<DeveloperState> {
    const refused = this.guard(projectId === 'jarvis');
    if (refused) return refused;
    const id = projectId.trim();
    const persisted =
      this.projectChat?.projectId === id
        ? {
            version: 2 as const,
            messages: this.projectChat.messages,
            decisions: this.projectChat.decisions,
            codingPick: this.projectChat.codingPick,
            webSearchUsed: this.projectChat.webSearchUsed,
            compareOffer: this.projectChat.compareOffer,
          }
        : await this.projects.loadChatState(id);
    if (!persisted.messages.some((m) => m.role === 'user')) {
      this.notice = 'Écris au moins un message dans la discussion avant de lancer une mission.';
      return this.emit();
    }
    const { summary, discussionContext } = missionRequestFromProjectChat(
      persisted.messages,
      persisted.decisions,
    );
    const extras = {
      discussionContext,
      projectDecisions: persisted.decisions,
      ...(persisted.codingPick
        ? { coderOverride: { model: persisted.codingPick.model, reason: persisted.codingPick.reason } }
        : {}),
    };
    return this.missions.start('modify', summary, false, id, undefined, extras);
  }

  async compareProjectChatModels(
    projectId: string,
    alternateModel: string,
  ): Promise<DeveloperState> {
    const refused = this.guard(projectId === 'jarvis');
    if (refused) return refused;
    const id = projectId.trim();
    const alternate = alternateModel.trim();
    const primary = this.deps.getSettings().developer.codeModel;
    if (!primary) {
      this.notice = 'Choisis d’abord un modèle de code.';
      return this.emit();
    }
    if (alternate === primary) {
      this.notice = 'Choisis un autre modèle installé que le modèle de code actuel.';
      return this.emit();
    }
    const status = await this.ollama().status();
    const installed = new Set(status.models.map((m) => m.name));
    if (!installed.has(primary) || !installed.has(alternate)) {
      this.notice = 'Les deux modèles doivent être installés dans Ollama (pas de téléchargement ici).';
      return this.emit();
    }
    const resolved = await this.projects.resolve(id);
    if (typeof resolved === 'string') {
      this.notice = resolved;
      return this.emit();
    }
    const persisted = await this.projects.loadChatState(id);
    const { summary, discussionContext } = missionRequestFromProjectChat(
      persisted.messages,
      persisted.decisions,
    );
    const planContext = [
      discussionContext,
      persisted.decisions.length
        ? `Décisions : ${persisted.decisions.join(' · ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return this.tasks.compareModels(
      summary,
      {
        id: resolved.id,
        root: resolved.root,
        profile: resolved.profile,
        templateId: resolved.template,
      },
      primary,
      alternate,
      planContext,
    );
  }

  async applyTask(): Promise<DeveloperState> {
    return this.guard() ?? this.tasks.apply();
  }

  async revertTask(): Promise<DeveloperState> {
    return this.guard() ?? this.tasks.revertApply();
  }

  async realBenchmark(modelId: string): Promise<DeveloperState> {
    return this.guard(true) ?? this.models.realBenchmark(modelId);
  }

  private emit(): DeveloperState {
    const state = this.state();
    this.deps.emit(state);
    return state;
  }

  private guard(needsRepo = false): DeveloperState | null {
    if (!this.enabled()) {
      this.notice = DEVELOPER_DISABLED_NOTICE;
      return this.state();
    }
    if (this.controller) {
      this.notice = 'Une tâche est déjà en cours : attends sa fin ou annule-la.';
      return this.emit();
    }
    if (needsRepo && !this.repo?.ok) {
      this.notice = 'Choisis et vérifie d’abord la copie de travail (Réglages → Développeur).';
      return this.emit();
    }
    this.notice = null;
    return null;
  }

  private setRepo(facts: RepoFacts): void {
    const report = validateRepo(facts, this.deps.appVersion(), this.deps.oneDriveRoots());
    this.repoPath = facts.path;
    this.repoFacts = facts;
    this.repo = {
      ok: report.ok,
      checks: report.checks,
      branch: facts.branch ?? null,
      version: facts.desktopVersion ?? null,
    };
  }

  async detect(): Promise<DeveloperState> {
    const refused = this.guard();
    if (refused) return refused;
    const saved = this.deps.getSettings().developer.repoPath;
    const candidates = [
      ...(saved ? [saved] : []),
      ...candidateRepoPaths({ platform: this.deps.platform, home: this.deps.home }),
    ];
    const found = await detectRepo([...new Set(candidates)], this.run);
    if (found) this.setRepo(found);
    else {
      this.repoPath = this.state().suggestedPath;
      this.repo = null;
      this.notice = `Aucune copie de Jarvis trouvée. Jarvis peut cloner le code dans ${this.repoPath}, avec ta confirmation.`;
    }
    return this.emit();
  }

  async validate(path: string): Promise<DeveloperState> {
    const refused = this.guard();
    if (refused) return refused;
    const trimmed = path.trim();
    if (!trimmed) {
      this.notice = 'Indique le dossier de la copie de travail.';
      return this.emit();
    }
    this.setRepo(await gatherRepoFacts(trimmed, this.run));
    return this.emit();
  }

  private async probe(): Promise<EnvironmentProbe> {
    this.environment = await probeEnvironment({
      run: this.run,
      platform: this.deps.platform,
      diskPath: this.repoPath || this.state().suggestedPath,
      cwd: this.deps.home,
      freeBytes: this.deps.freeBytes,
    });
    return this.environment;
  }

  async checkEnvironment(): Promise<DeveloperState> {
    const refused = this.guard();
    if (refused) return refused;
    await this.probe();
    return this.emit();
  }

  async clone(path: string): Promise<DeveloperState> {
    const refused = this.guard();
    if (refused) return refused;
    const target = path.trim() || this.state().suggestedPath;
    return this.runTask(
      'clone',
      `Cloner Jarvis dans ${target}`,
      [
        { id: 'environment', label: 'Git et place sur le disque' },
        { id: 'confirm', label: 'Ta confirmation' },
        { id: 'clone', label: 'Téléchargement du code (git clone)' },
        { id: 'validate', label: 'Vérification de la copie' },
      ],
      async (step) => {
        step('environment', 'running');
        const probe = await this.probe();
        const git = probe.report.checks.find((check) => check.id === 'git');
        if (git?.status !== 'ok') throw new Error(git?.detail ?? 'Git est introuvable.');
        const disk = probe.report.checks.find((check) => check.id === 'disk');
        if (disk?.status === 'fail') throw new Error(disk.detail);
        step('environment', 'done', [git.detail, disk?.detail].filter(Boolean).join(', '));
        const outcome = await this.callTool(
          'dev_clone_repository',
          { targetPath: target },
          step,
          'clone',
        );
        if (outcome.status !== 'ok') throw new Error(outcome.content);
        step('validate', 'running');
        this.setRepo(await gatherRepoFacts(target, this.run));
        step(
          'validate',
          this.repo?.ok ? 'done' : 'failed',
          this.repo?.ok ? `${this.repo.version} sur ${this.repo.branch}` : 'copie incomplète',
        );
        return `Code de Jarvis cloné dans ${target}.`;
      },
    );
  }

  async install(): Promise<DeveloperState> {
    const refused = this.guard(true);
    if (refused) return refused;
    return this.runTask(
      'install',
      'Installer les dépendances (npm ci)',
      [
        { id: 'environment', label: 'Node.js et npm' },
        { id: 'confirm', label: 'Ta confirmation' },
        { id: 'install', label: 'Installation (npm ci)' },
        { id: 'validate', label: 'Vérification de node_modules' },
      ],
      async (step) => {
        step('environment', 'running');
        const probe = await this.probe();
        if (!probe.nodePath || !probe.npmCli)
          throw new Error(
            'Node.js et npm sont introuvables : installe Node.js LTS (voir les vérifications).',
          );
        step(
          'environment',
          'done',
          probe.report.checks
            .filter((check) => check.id === 'node' || check.id === 'npm')
            .map((check) => check.detail)
            .join(', '),
        );
        const outcome = await this.callTool('dev_install_dependencies', {}, step, 'install');
        if (outcome.status !== 'ok') throw new Error(outcome.content);
        step('validate', 'running');
        this.setRepo(await gatherRepoFacts(this.repoPath, this.run));
        step(
          'validate',
          this.repoFacts?.hasNodeModules ? 'done' : 'failed',
          this.repoFacts?.hasNodeModules ? 'node_modules présent' : 'node_modules absent',
        );
        return 'Dépendances installées.';
      },
    );
  }

  async analyze(): Promise<DeveloperState> {
    const refused = this.guard(true);
    if (refused) return refused;
    return this.runTask(
      'analyze',
      'Analyser mon architecture',
      [...ANALYSIS_STEPS],
      async (step, signal) => {
        const markdown = await analyzeArchitecture({
          call: (name, args) => this.callTool(name, args ?? {}, step),
          step,
          signal,
          now: () => (this.deps.now ? this.deps.now() : new Date()),
        });
        this.report = { markdown, createdAt: Date.now() };
        return 'Rapport prêt.';
      },
    );
  }

  private async runTask(
    kind: DevTaskKind,
    title: string,
    steps: ReadonlyArray<{ id: string; label: string }>,
    work: (
      step: (id: string, status: DevStepStatus, detail?: string) => void,
      signal: AbortSignal,
      addStep: (id: string, label: string, beforeId?: string) => void,
    ) => Promise<string>,
  ): Promise<DeveloperState> {
    const controller = new AbortController();
    this.controller = controller;
    const task: DevTask = {
      id: randomId(),
      kind,
      title,
      steps: steps.map((s): DevStep => ({ ...s, status: 'pending' })),
      startedAt: Date.now(),
      log: [],
    };
    this.task = task;
    this.emit();
    const step = (id: string, status: DevStepStatus, detail?: string): void => {
      const target = task.steps.find((item) => item.id === id);
      if (!target) return;
      target.status = status;
      if (detail !== undefined) target.detail = detail;
      this.emit();
    };
    const addStep = (id: string, label: string, beforeId?: string): void => {
      if (task.steps.some((item) => item.id === id)) return;
      const index = beforeId ? task.steps.findIndex((item) => item.id === beforeId) : -1;
      const entry: DevStep = { id, label, status: 'pending' };
      if (index >= 0) task.steps.splice(index, 0, entry);
      else task.steps.push(entry);
      this.emit();
    };
    try {
      task.message = await work(step, controller.signal, addStep);
      task.outcome = 'success';
    } catch (error) {
      const cancelled = controller.signal.aborted;
      for (const item of task.steps) {
        if (item.status === 'running') item.status = cancelled ? 'skipped' : 'failed';
        else if (item.status === 'pending') item.status = 'skipped';
      }
      task.outcome = cancelled ? 'cancelled' : 'failed';
      task.message = cancelled ? 'Annulé.' : error instanceof Error ? error.message : String(error);
    } finally {
      task.finishedAt = Date.now();
      this.controller = null;
      this.confirmation = null;
    }
    return this.emit();
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
    step: (id: string, status: DevStepStatus, detail?: string) => void,
    workStep?: string,
  ): Promise<ToolCallOutcome> {
    const signal = this.controller?.signal;
    const outcome = await this.manager.execute(
      { id: randomId(), name, arguments: args },
      {
        signal,
        requestConfirmation: async (request) => {
          step('confirm', 'running', 'en attente de ta réponse');
          const approved = await this.askUser(request, signal);
          step('confirm', approved ? 'done' : 'failed', approved ? 'acceptée' : 'refusée');
          if (approved && workStep) step(workStep, 'running');
          return approved;
        },
        onProgress: (line) => this.appendLog(line),
      },
    );
    void this.deps.auditLog.append(buildAuditEntry(outcome));
    if (workStep && outcome.decision !== 'refused') {
      step(
        workStep,
        outcome.status === 'ok' ? 'done' : 'failed',
        outcome.status === 'ok' ? undefined : outcome.content.split('\n')[0],
      );
    }
    return outcome;
  }

  private askUser(
    request: ConfirmationRequest,
    signal?: AbortSignal,
    extra?: AskExtra,
  ): Promise<boolean> {
    const requestId = randomId();
    const safety =
      extra?.safety ?? classifyCommand((request.command ?? '').split('\n')[0] || request.toolName);
    if (safety.level === 'denied') {
      this.notice = `Refusé par le tri de sécurité : ${safety.reasons[0]}`;
      return Promise.resolve(false);
    }
    this.confirmation = {
      requestId,
      toolName: request.toolName,
      details: request.details,
      command: request.command,
      forced: request.forced,
      safety,
      ...(extra ? { reason: extra.reason, diff: extra.diff, findings: extra.findings } : {}),
    };
    this.emit();
    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean): void => {
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(requestId);
        this.confirmation = null;
        this.emit();
        resolve(approved);
      };
      const onAbort = (): void => settle(false);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(requestId, settle);
    });
  }

  private logTimer: ReturnType<typeof setTimeout> | null = null;

  /** Au plus quatre envois par seconde pour les sorties longues (npm, téléchargement). */
  private scheduleEmit(): void {
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => {
      this.logTimer = null;
      this.emit();
    }, 250);
  }

  private appendLog(line: string): void {
    if (!this.task) return;
    this.task.log = [...this.task.log, redactSecrets(line).slice(0, 400)].slice(-MAX_LOG_LINES);
    this.scheduleEmit();
  }

  async checkHardware(): Promise<DeveloperState> {
    return this.guard() ?? this.models.checkHardware();
  }

  async calibrate(model?: string): Promise<DeveloperState> {
    return this.guard() ?? this.models.calibrate(model);
  }

  async validateConfig(modelId: string, expertsInRam: boolean): Promise<DeveloperState> {
    return this.guard() ?? this.models.validate(modelId, expertsInRam);
  }

  async confirmExperts(applied: boolean): Promise<DeveloperState> {
    return this.guard() ?? this.models.confirmExperts(applied);
  }

  async pull(modelId: string): Promise<DeveloperState> {
    return this.guard() ?? this.models.pull(modelId);
  }

  async refreshOllamaModels(): Promise<DeveloperState> {
    return this.guard() ?? this.models.refreshOllamaModels();
  }

  async pullOllamaModel(model: string): Promise<DeveloperState> {
    return this.guard() ?? this.models.pullOllamaModel(model);
  }

  async benchmark(modelId: string): Promise<DeveloperState> {
    return this.guard() ?? this.models.benchmark(modelId);
  }

  async startTask(request: string): Promise<DeveloperState> {
    return this.guard() ?? this.tasks.start(request);
  }

  /** Répond au plan en attente : la tâche en cours attend justement cette réponse. */
  approvePlan(approved: boolean): DeveloperState {
    if (!this.enabled()) return this.guard() ?? this.state();
    return this.tasks.approve(approved);
  }

  async rollbackTask(checkpoint: string): Promise<DeveloperState> {
    return this.guard() ?? this.tasks.rollback(checkpoint);
  }

  async discardTask(): Promise<DeveloperState> {
    return this.guard() ?? this.tasks.discard();
  }

  async keepTask(): Promise<DeveloperState> {
    return this.guard() ?? this.tasks.keep();
  }

  async listSandboxes(): Promise<DeveloperState> {
    if (!this.enabled()) return this.guard() ?? this.state();
    return this.tasks.listSandboxes();
  }

  async cleanSandboxes(paths: string[]): Promise<DeveloperState> {
    return this.guard() ?? this.tasks.cleanSandboxes(paths);
  }

  cancel(): void {
    this.controller?.abort();
    for (const resolve of this.pending.values()) resolve(false);
    this.pending.clear();
  }

  respondConfirmation(requestId: string, approved: boolean): void {
    const resolve = this.pending.get(requestId);
    if (!resolve) return;
    this.pending.delete(requestId);
    resolve(approved);
  }
}
