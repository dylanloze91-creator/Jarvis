import type { MissionState, MissionStep } from '../engine/mission.js';
import type { MissionGate } from '../engine/difficulty.js';
import type { MissionKind } from '../engine/router.js';
import type { ProposerMissionType } from './proposerMission.js';

export type ChatMissionProposalStatus = 'pending' | 'declined' | 'launched';

/** Carte « Mission proposée » (5.0.68). */
export interface ChatMissionProposalPayload {
  proposalId: string;
  missionType: ProposerMissionType;
  objectif: string;
  /** Indice du modèle Code (projet? dans l'outil) — jamais utilisé seul pour choisir le projet. */
  projetHint?: string;
  /** Choix explicite de l'utilisateur avant « Lancer ». */
  projectId: string | null;
  kind: MissionKind;
  codeModel: string | null;
  /** Modèle Codeur absent ou non configuré. */
  codeModelMissing: boolean;
  gate: MissionGate;
  status: ChatMissionProposalStatus;
  missionId?: string;
  /** Une mission tourne déjà : la proposition reste visible mais non lançable. */
  blockedMessage?: string;
}

export interface ChatMissionTrackPayload {
  missionId: string;
  projectId: string;
  kind: MissionKind;
  request: string;
  status: MissionState['status'];
  steps: MissionStep[];
  /** Questions REASONER en attente de réponse dans la discussion. */
  waitingQuestions: string[];
  collapsed?: boolean;
}

export interface ChatMissionReportPayload {
  missionId: string;
  projectId: string;
  markdown: string;
  worktreePath: string | null;
  taskClosed: null | 'kept' | 'discarded';
  applied: boolean;
}

export type ChatMissionEnvelope =
  | { kind: 'proposal'; data: ChatMissionProposalPayload }
  | { kind: 'track'; data: ChatMissionTrackPayload }
  | { kind: 'report'; data: ChatMissionReportPayload }
  | { kind: 'notice'; text: string };

export function trackFromMission(mission: MissionState): ChatMissionTrackPayload {
  const waitingQuestions =
    mission.status === 'waiting-answers'
      ? mission.steps
          .filter((step) => step.status === 'waiting' && step.actor === 'REASONER')
          .map((step) => step.detail ?? step.label)
          .filter(Boolean)
      : [];
  return {
    missionId: mission.id,
    projectId: mission.projectId,
    kind: mission.kind,
    request: mission.request,
    status: mission.status,
    steps: mission.steps,
    waitingQuestions,
  };
}
