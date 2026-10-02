import type { CommandClassification, DevCheck } from '@jarvis/core';

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
} as const;

export type DevStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface DevStep {
  id: string;
  label: string;
  status: DevStepStatus;
  detail?: string;
}

export type DevTaskKind = 'analyze' | 'clone' | 'install';

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
}
