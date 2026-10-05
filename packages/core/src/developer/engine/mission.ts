import { MISSION_CHAINS, type ChainActor, type MissionKind } from './router.js';
import type { MissionGate } from './difficulty.js';
import type { CheckedProposal } from './improve.js';
import type { MissionLearning } from '../knowledge/learning.js';
import type { GoalOutput } from './specialistSchemas.js';

export type MissionStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'waiting';

/** Une ligne de la vue de mission : un spécialiste, ce qu'il fait, avec quel modèle, ce qu'il a rendu. */
export interface MissionStep {
  id: string;
  actor: ChainActor;
  label: string;
  status: MissionStepStatus;
  model?: string;
  detail?: string;
  rounds?: number;
  files?: string[];
  error?: string;
  /** Sortie JSON validée du spécialiste. */
  output?: unknown;
  tokPerSec?: number | null;
  /** Mesuré sur Ollama à la fin de l'étape (/api/ps, nvidia-smi). */
  resources?: { vramBytes: number | null; ramBytes: number | null; gpuUsedMiB: number | null };
  startedAt?: number;
  finishedAt?: number;
}

export type MissionStatus =
  'running' | 'waiting-answers' | 'task' | 'finished' | 'failed' | 'cancelled';

export interface MissionState {
  id: string;
  projectId: string;
  kind: MissionKind;
  request: string;
  /** L'utilisateur a choisi de ne pas répondre à des questions. */
  skipQuestions: boolean;
  status: MissionStatus;
  goal: GoalOutput | null;
  answers: Array<{ question: string; answer: string }>;
  steps: MissionStep[];
  /** Tâche de code de la boucle de modification, s'il y en a une. */
  taskId: string | null;
  verdict: 'success' | 'failed' | 'stopped' | null;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
  /** Mission « Améliorer » (0.5.5) : propositions et leurs preuves relues. */
  proposals?: CheckedProposal[];
  /** Mission née d'une proposition retenue (0.5.5). */
  fromProposal?: { missionId: string; index: number };
  /** Difficulté estimée avant le départ, face au modèle Codeur (5.0.1). */
  gate?: MissionGate;
  /** Fiche solution validée enregistrée (ou refusée) à la fin de la boucle de code. */
  learning?: MissionLearning;
}

export interface MissionSummary {
  id: string;
  kind: MissionKind;
  request: string;
  status: MissionStatus;
  verdict: MissionState['verdict'];
  createdAt: number;
  updatedAt: number;
}

export function createMission(input: {
  id: string;
  projectId: string;
  kind: MissionKind;
  request: string;
  skipQuestions: boolean;
  now: number;
}): MissionState {
  return {
    id: input.id,
    projectId: input.projectId,
    kind: input.kind,
    request: input.request,
    skipQuestions: input.skipQuestions,
    status: 'running',
    goal: null,
    answers: [],
    steps: MISSION_CHAINS[input.kind].map((step) => ({ ...step, status: 'pending' })),
    taskId: null,
    verdict: null,
    summary: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function summarizeMission(mission: MissionState): MissionSummary {
  const { id, kind, request, status, verdict, createdAt, updatedAt } = mission;
  return { id, kind, request, status, verdict, createdAt, updatedAt };
}

export function upsertStep(mission: MissionState, step: MissionStep, now: number): MissionStep {
  const existing = mission.steps.find((s) => s.id === step.id);
  if (existing) Object.assign(existing, step);
  else mission.steps.push(step);
  mission.updatedAt = now;
  return existing ?? step;
}

export function patchStep(
  mission: MissionState,
  id: string,
  patch: Partial<MissionStep>,
  now: number,
): void {
  const step = mission.steps.find((s) => s.id === id);
  if (!step) return;
  Object.assign(step, patch);
  if (patch.status === 'running' && step.startedAt === undefined) step.startedAt = now;
  if (patch.status === 'done' || patch.status === 'failed' || patch.status === 'skipped')
    step.finishedAt = now;
  mission.updatedAt = now;
}

/** Une mission relue sur le disque : forme minimale vérifiée, sinon ignorée. */
export function isMissionState(value: unknown): value is MissionState {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<MissionState>;
  return (
    typeof m.id === 'string' &&
    typeof m.request === 'string' &&
    typeof m.kind === 'string' &&
    Array.isArray(m.steps) &&
    typeof m.createdAt === 'number'
  );
}
