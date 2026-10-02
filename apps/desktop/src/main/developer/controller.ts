import {
  SUGGESTED_REPO_PATH,
  buildAuditEntry,
  candidateRepoPaths,
  classifyCommand,
  randomId,
  redactSecrets,
  resolveLocalOllamaBase,
  validateRepo,
  type AuditLogStore,
  type ProviderRegistry,
  type ConfirmationRequest,
  type RepoFacts,
  type Settings,
  type ToolCallOutcome,
  type ToolManager,
} from '@jarvis/core';
import { join } from 'node:path';
import type {
  DevConfirmation,
  DevStep,
  DevStepStatus,
  DevTask,
  DevTaskKind,
  DeveloperState,
} from '../../shared/developerIpc.js';
import { ANALYSIS_STEPS, analyzeArchitecture } from './analysis.js';
import { measureFree, probeEnvironment, type EnvironmentProbe } from './environment.js';
import { detectRepo, gatherRepoFacts } from './repo.js';
import { runProcess, type Runner } from './runner.js';
import { createDeveloperToolManager } from './tools/index.js';
import { ollamaModelsDir } from './models/hardwareProbe.js';
import { createOllamaApi, type OllamaApi } from './models/ollamaApi.js';
import { CodeModelStore } from './models/store.js';
import { CodeModelWorkflow, type WorkflowDeps } from './models/workflow.js';

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
  userDataPath(): string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  system?: WorkflowDeps['system'];
}

export const DEVELOPER_DISABLED_NOTICE =
  'Le mode Développeur est coupé : active-le dans Réglages → Développeur.';
const MAX_LOG_LINES = 40;

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
  private notice: string | null = null;
  private controller: AbortController | null = null;
  private readonly pending = new Map<string, (approved: boolean) => void>();
  private readonly models: CodeModelWorkflow;
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
        repoRoot: () => (this.repo?.ok ? this.repoPath : null),
        nodePath: async () => {
          if (!this.environment) await this.probe();
          return this.environment?.nodePath ?? null;
        },
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
      suggestedPath:
        this.deps.platform === 'win32'
          ? SUGGESTED_REPO_PATH
          : candidateRepoPaths({ platform: this.deps.platform, home: this.deps.home })[0]!,
      repoPath: this.repoPath,
      repo: this.repo,
      environment: this.environment
        ? { ok: this.environment.report.ok, checks: this.environment.report.checks }
        : null,
      task: this.task,
      confirmation: this.confirmation,
      report: this.report,
      model: this.models.state(),
      busy: this.controller !== null,
      notice: this.notice,
    };
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
    try {
      task.message = await work(step, controller.signal);
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

  private askUser(request: ConfirmationRequest, signal?: AbortSignal): Promise<boolean> {
    const requestId = randomId();
    const safety = classifyCommand((request.command ?? '').split('\n')[0] || request.toolName);
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

  async benchmark(modelId: string): Promise<DeveloperState> {
    return this.guard() ?? this.models.benchmark(modelId);
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
