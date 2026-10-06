import type {
  BenchResult,
  Calibration,
  CheckReport,
  CheckedAnswer,
  MissionKind,
  MissionGate,
  MissionState,
  MissionSummary,
  ProjectTemplateId,
  RealBenchResult,
  CodeModelSpec,
  CommandClassification,
  DevCheck,
  DiffFile,
  HardwareFacts,
  ManualPassageView,
  OllamaModelInfo,
  Prediction,
  ScanFinding,
  ServerInstructions,
  TestRunSummary,
  TestSuiteId,
  VariableChange,
} from '@jarvis/core';

export interface CodeTaskPlanFile {
  path: string;
  action: 'create' | 'edit' | 'delete';
  reason: string;
  /** Fichier du cœur : redemande toujours, même après la validation du plan. */
  core: string | null;
  problem: string | null;
  exists: boolean;
}

export interface CodeTaskRun {
  label: string;
  at: number;
  results: TestRunSummary[];
  newFailures: string[];
  fixed: string[];
  ok: boolean;
}

/** Tâche de code (0.4.25) : plan → validation → modification → tests → corrections → rapport. */
export interface CodeTaskState {
  id: string;
  request: string;
  model: string;
  status:
    | 'planning'
    | 'awaiting-approval'
    | 'running'
    | 'paused'
    | 'finished'
    | 'failed'
    | 'refused'
    | 'cancelled';
  branch: string;
  worktreePath: string;
  baseCommit: string | null;
  plan: {
    summary: string;
    criteria: string[];
    files: CodeTaskPlanFile[];
    tests: TestSuiteId[];
    testCommands: string[];
    maxTestSeries: number;
    /** Fichiers du plan modifiés mais non enregistrés dans la copie de l'utilisateur. */
    dirtyFiles: string[];
    branchCommand: string;
    installCommand: string;
  } | null;
  approvedAt: number | null;
  checkpoints: Array<{ sha: string; label: string; at: number }>;
  diff: DiffFile[];
  baseline: TestRunSummary[] | null;
  runs: CodeTaskRun[];
  attempts: number;
  maxAttempts: number;
  testSeriesUsed: number;
  findings: ScanFinding[];
  pauses: Array<{ startedAt: number; endedAt: number | null }>;
  /** Actions faites sans clic parce que le plan validé les couvrait (décision 9). */
  planApproved: Array<{ tool: string; target: string; at: number }>;
  asked: number;
  report: { markdown: string; verdict: 'success' | 'failed' | 'stopped' } | null;
  /** Revue du diff par le REVIEWER d'une mission (0.5.2). */
  review?: { summary: string; blocking: string[]; model: string; at: number } | null;
  /** Plan de secours utilisé (5.0.1) : pourquoi. */
  planFallback?: string;
  /** Boucle de correction arrêtée net (5.0.1) : la correction a reproduit le même échec. */
  repeatedFailure?: { attempt: number; failures: string[]; unused: number };
  closed: null | 'kept' | 'discarded';
  startedAt: number;
  finishedAt: number | null;
  /** Projet de la tâche (0.5.3) ; absent = Jarvis. */
  projectId?: string;
  /** Passages du manuel technique consultés pour cette tâche. */
  manualPassages?: ManualPassageView[];
  /** Bloc « Manuel pertinent » injecté dans les prompts Codeur. */
  manualBlock?: string;
  /** Fusion dans la copie de l'utilisateur après sa carte (0.5.3), et son annulation éventuelle. */
  applied?: {
    at: number;
    root: string;
    branch: string;
    preHead: string;
    merge: string;
    revertedAt: number | null;
    revert: string | null;
  } | null;
}

/** Un projet de Jarvis Développeur (0.5.3) : Jarvis lui-même, ou un projet Node importé ou créé. */
export interface ProjectView {
  id: string;
  name: string;
  path: string;
  kind: 'jarvis' | 'node' | 'dotnet';
  origin: 'jarvis' | 'imported' | 'created';
  template: ProjectTemplateId | null;
  description: string;
  /** Prêt pour une mission (vérifications sans échec). */
  ok: boolean;
  checks: DevCheck[];
  branch: string | null;
  /** Mémoire du projet donnée aux spécialistes ; `memoryDefault` : jamais modifiée. */
  memory: string;
  memoryDefault: boolean;
  /** Ce que « Construire » lance, ou null. */
  build: { command: string; artifact: string | null } | null;
}

export interface SandboxView {
  path: string;
  branch: string;
  head: string | null;
  modifiedAt: number | null;
  missing: boolean;
  current: boolean;
}

export interface CodeModelCandidate {
  spec: CodeModelSpec;
  installed: boolean;
  /** Estimations (jamais des mesures) : placement automatique, et avec les experts en RAM si le modèle s'y prête. */
  auto: Prediction | null;
  experts: Prediction | null;
}

/** Modèle de code (0.4.24) : matériel → étalonnage → configuration proposée → validation → téléchargement confirmé → banc → choix. */
export interface CodeModelState {
  hardware: { facts: HardwareFacts; report: CheckReport; at: number } | null;
  calibration: Calibration | null;
  /** Modèle déjà installé proposé pour l'étalonnage. */
  calibrationModel: string | null;
  candidates: CodeModelCandidate[];
  experts: {
    changes: VariableChange[];
    instructions: ServerInstructions;
    confirmedAt: number | null;
  };
  validation: {
    modelId: string;
    expertsInRam: boolean;
    at: number;
    prediction: Prediction | null;
  } | null;
  pull: { modelId: string; status: string; completed: number; total: number; done: boolean } | null;
  benches: BenchResult[];
  /** Banc réel sur le code de Jarvis (0.5.1) : scores par rôle, aucun choix. */
  realBenches: RealBenchResult[];
  /** Modèles présents dans Ollama, pour lancer le banc réel sans rien télécharger. */
  installedModels: string[];
  /** Dernière liste brute renvoyée par Ollama `/api/tags`. */
  ollamaModels: OllamaModelInfo[];
  ollamaModelsAt: number | null;
  ollamaListMessage: string | null;
}

/** Question sur le code (0.5.1) : réponse et citations relues dans les fichiers. */
export interface ProjectChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: number;
}

/** Discussion avec le modèle de code sur un projet (importé ou créé). */
export interface ProjectChatView {
  projectId: string;
  projectName: string;
  messages: ProjectChatMessage[];
}

export interface AskView {
  question: string;
  model: string;
  at: number;
  durationMs: number;
  checked: CheckedAnswer;
  rounds: number;
  calls: number;
  retried: boolean;
}

/** Canaux de Jarvis Développeur. Refusés (sauf l'état) tant que le mode est coupé. */
export const DeveloperChannel = {
  status: 'dev:status',
  detect: 'dev:detect',
  validate: 'dev:validate',
  environment: 'dev:environment',
  clone: 'dev:clone',
  install: 'dev:install',
  analyze: 'dev:analyze',
  cancel: 'dev:cancel',
  confirmRespond: 'dev:confirm-respond',
  event: 'dev:event',
  hardware: 'dev:hardware',
  calibrate: 'dev:calibrate',
  validateConfig: 'dev:validate-config',
  experts: 'dev:experts',
  pull: 'dev:pull',
  refreshOllamaModels: 'dev:refresh-ollama-models',
  pullOllamaModel: 'dev:pull-ollama-model',
  benchmark: 'dev:benchmark',
  taskStart: 'dev:task-start',
  taskApprove: 'dev:task-approve',
  taskRollback: 'dev:task-rollback',
  taskDiscard: 'dev:task-discard',
  taskKeep: 'dev:task-keep',
  sandboxes: 'dev:sandboxes',
  sandboxesClean: 'dev:sandboxes-clean',
  ask: 'dev:ask',
  realBenchmark: 'dev:real-benchmark',
  missionStart: 'dev:mission-start',
  missionAnswer: 'dev:mission-answer',
  missions: 'dev:missions',
  missionOpen: 'dev:mission-open',
  projects: 'dev:projects',
  projectImport: 'dev:project-import',
  projectForget: 'dev:project-forget',
  projectMemory: 'dev:project-memory',
  projectBuild: 'dev:project-build',
  projectChatOpen: 'dev:project-chat-open',
  projectChatSend: 'dev:project-chat-send',
  taskApply: 'dev:task-apply',
  taskRevert: 'dev:task-revert',
  missionProposal: 'dev:mission-proposal',
} as const;

export type DevStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface DevStep {
  id: string;
  label: string;
  status: DevStepStatus;
  detail?: string;
}

export type DevTaskKind =
  | 'analyze'
  | 'clone'
  | 'install'
  | 'calibrate'
  | 'pull'
  | 'benchmark'
  | 'code'
  | 'rollback'
  | 'discard'
  | 'cleanup'
  | 'ask'
  | 'real-benchmark'
  | 'mission'
  | 'apply'
  | 'revert'
  | 'build'
  | 'project'
  | 'project-chat';

export interface DevTask {
  id: string;
  kind: DevTaskKind;
  title: string;
  steps: DevStep[];
  startedAt: number;
  finishedAt?: number;
  outcome?: 'success' | 'failed' | 'cancelled';
  /** Dernières lignes de sortie (git, npm). */
  log: string[];
  message?: string;
}

export interface DevConfirmation {
  requestId: string;
  toolName: string;
  details: string;
  command?: string;
  forced?: boolean;
  /** Tri de sécurité de la commande affichée. */
  safety: CommandClassification;
  /** Pourquoi Jarvis redemande malgré le plan validé (décision 9). */
  reason?: string;
  /** Diff exact de la modification demandée. */
  diff?: DiffFile[];
  /** Revue du diff avant les tests : code sensible trouvé. */
  findings?: ScanFinding[];
}

export interface DeveloperState {
  enabled: boolean;
  suggestedPath: string;
  repoPath: string;
  repo: { ok: boolean; checks: DevCheck[]; branch: string | null; version: string | null } | null;
  environment: { ok: boolean; checks: DevCheck[] } | null;
  task: DevTask | null;
  confirmation: DevConfirmation | null;
  report: { markdown: string; createdAt: number } | null;
  busy: boolean;
  /** Dernier message à montrer (erreur ou information). */
  notice: string | null;
  model: CodeModelState;
  codeTask: CodeTaskState | null;
  /** Copies isolées jarvis-dev/* trouvées (null : pas encore listées). */
  sandboxes: SandboxView[] | null;
  worktreeRoot: string;
  /** Dernière question sur le code. */
  ask: AskView | null;
  /** Mission affichée (en cours ou rouverte depuis l'historique). */
  mission: MissionState | null;
  /** Historique des missions du projet (null : pas encore lu). */
  missions: MissionSummary[] | null;
  /** Projet de l'historique affiché. */
  missionsProject: string;
  /** Dernière mission refusée par le contrôle de difficulté (5.0.1), avec sa version ciblée. */
  missionGate?: MissionGate | null;
  /** Projets connus, Jarvis en premier (null : pas encore lus). */
  projects: ProjectView[] | null;
  /** Discussion projet ouverte (onglet Projet). */
  projectChat: ProjectChatView | null;
  /** Dossier des nouveaux projets (décision D2). */
  projectsRoot: string;
  /** SDK .NET trouvé (0.5.4) et commande d'installation à lancer soi-même ; null : pas encore cherché. */
  dotnet: { sdks: string[]; hint: string | null } | null;
}

export interface DeveloperApi {
  status(): Promise<DeveloperState>;
  detect(): Promise<DeveloperState>;
  validate(path: string): Promise<DeveloperState>;
  checkEnvironment(): Promise<DeveloperState>;
  clone(path: string): Promise<DeveloperState>;
  install(): Promise<DeveloperState>;
  analyze(): Promise<DeveloperState>;
  cancel(): Promise<void>;
  respondConfirmation(requestId: string, approved: boolean): Promise<void>;
  onEvent(listener: (state: DeveloperState) => void): () => void;
  checkHardware(): Promise<DeveloperState>;
  calibrate(model?: string): Promise<DeveloperState>;
  validateConfig(modelId: string, expertsInRam: boolean): Promise<DeveloperState>;
  /** L'utilisateur dit avoir appliqué (ou retiré) lui-même les variables « experts en RAM ». */
  confirmExperts(applied: boolean): Promise<DeveloperState>;
  pull(modelId: string): Promise<DeveloperState>;
  refreshOllamaModels(): Promise<DeveloperState>;
  /** Téléchargement confirmé d’un nom Ollama libre (hors catalogue). */
  pullOllamaModel(model: string): Promise<DeveloperState>;
  benchmark(modelId: string): Promise<DeveloperState>;
  startTask(request: string): Promise<DeveloperState>;
  approvePlan(approved: boolean): Promise<DeveloperState>;
  rollbackTask(checkpoint: string): Promise<DeveloperState>;
  discardTask(): Promise<DeveloperState>;
  keepTask(): Promise<DeveloperState>;
  listSandboxes(): Promise<DeveloperState>;
  cleanSandboxes(paths: string[]): Promise<DeveloperState>;
  ask(question: string): Promise<DeveloperState>;
  realBenchmark(modelId: string): Promise<DeveloperState>;
  /** `projectId` absent : Jarvis. Ignoré pour « Nouveau projet ». */
  startMission(
    kind: MissionKind,
    request: string,
    skipQuestions: boolean,
    projectId?: string,
  ): Promise<DeveloperState>;
  answerMission(answers: string[]): Promise<DeveloperState>;
  listMissions(projectId?: string): Promise<DeveloperState>;
  openMission(id: string, projectId?: string): Promise<DeveloperState>;
  listProjects(): Promise<DeveloperState>;
  importProject(path: string): Promise<DeveloperState>;
  forgetProject(id: string): Promise<DeveloperState>;
  saveProjectMemory(id: string, notes: string): Promise<DeveloperState>;
  buildProject(id: string): Promise<DeveloperState>;
  openProjectChat(projectId: string): Promise<DeveloperState>;
  sendProjectChat(projectId: string, text: string): Promise<DeveloperState>;
  applyTask(): Promise<DeveloperState>;
  revertTask(): Promise<DeveloperState>;
  /** Proposition retenue d'une mission « Améliorer » → nouvelle mission sur le même projet (0.5.5). */
  startProposal(missionId: string, index: number, projectId: string): Promise<DeveloperState>;
}
