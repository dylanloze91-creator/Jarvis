import type {
  BenchResult,
  Calibration,
  CheckReport,
  CodeModelSpec,
  CommandClassification,
  DevCheck,
  HardwareFacts,
  Prediction,
  ServerInstructions,
  VariableChange,
} from '@jarvis/core';

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
  benchmark: 'dev:benchmark',
} as const;

export type DevStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface DevStep {
  id: string;
  label: string;
  status: DevStepStatus;
  detail?: string;
}

export type DevTaskKind = 'analyze' | 'clone' | 'install' | 'calibrate' | 'pull' | 'benchmark';

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
  benchmark(modelId: string): Promise<DeveloperState>;
}
