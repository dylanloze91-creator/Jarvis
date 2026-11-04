import {
  assessMission,
  chatMissionsEnabled,
  missionKindFromProposerType,
  modelCapability,
  randomId,
  type ChatMissionEnvelope,
  type ChatMissionProposalPayload,
  type ProposerMissionInput,
  type RealBenchResult,
  type Settings,
} from '@jarvis/core';
import type { DeveloperController } from '../developer/controller.js';

export const CHAT_MISSION_VOICE_HINT =
  'Je te propose une mission pour ça, elle est à l’écran.';

export interface ChatMissionHubDeps {
  getSettings: () => Settings;
  developer: () => DeveloperController | null;
  realBenches?: () => RealBenchResult[];
  ollamaModels?: () => Array<{ name: string; parameterSize?: string }>;
}

export interface RecordedProposal {
  payload: ChatMissionProposalPayload;
  envelope: ChatMissionEnvelope;
  voiceHint: string;
}

/**
 * Pont entre le chat et Jarvis Développeur pour les missions lancées depuis la discussion (5.0.68).
 */
export class ChatMissionHub {
  private readonly proposals = new Map<string, ChatMissionProposalPayload>();
  private activeConversationId: string | null = null;
  private activeMissionMessageId: string | null = null;

  constructor(private readonly deps: ChatMissionHubDeps) {}

  enabled(): boolean {
    return chatMissionsEnabled(this.deps.getSettings());
  }

  setConversationContext(conversationId: string): void {
    this.activeConversationId = conversationId;
  }

  /** Une mission est en cours (running, task, waiting-answers). */
  missionBusy(): boolean {
    const dev = this.deps.developer();
    if (!dev) return false;
    const mission = dev.state().mission;
    if (!mission) return false;
    return mission.status === 'running' || mission.status === 'task' || mission.status === 'waiting-answers';
  }

  recordProposal(input: ProposerMissionInput): RecordedProposal {
    const settings = this.deps.getSettings();
    const dev = settings.developer;
    const kind = missionKindFromProposerType(input.type);
    const codeModel = dev.codeModel?.trim() || null;
    const models = this.deps.ollamaModels?.() ?? [];
    const capability = codeModel
      ? modelCapability(
          codeModel,
          this.deps.realBenches?.().find((b) => b.model === codeModel),
          models.find((m) => m.name === codeModel)?.parameterSize,
        )
      : {
          level: 0 as const,
          model: 'aucun modèle Codeur',
          source: 'inconnue' as const,
          coder: null,
          paramsB: null,
          detail: 'modèle non configuré',
        };
    const gate = assessMission(kind, input.objectif, capability);
    const proposalId = randomId();
    const blockedMessage = this.missionBusy()
      ? 'Une mission est déjà en cours. Termine-la ou annule-la avant d’en lancer une autre.'
      : undefined;
    const payload: ChatMissionProposalPayload = {
      proposalId,
      missionType: input.type,
      objectif: input.objectif.trim(),
      ...(input.projet ? { projetHint: input.projet.trim() } : {}),
      projectId: null,
      kind,
      codeModel,
      codeModelMissing: !codeModel,
      gate,
      status: 'pending',
      ...(blockedMessage ? { blockedMessage } : {}),
    };
    this.proposals.set(proposalId, payload);
    const envelope: ChatMissionEnvelope = { kind: 'proposal', data: payload };
    return { payload, envelope, voiceHint: CHAT_MISSION_VOICE_HINT };
  }

  getProposal(proposalId: string): ChatMissionProposalPayload | undefined {
    return this.proposals.get(proposalId);
  }

  patchProposal(proposalId: string, patch: Partial<ChatMissionProposalPayload>): ChatMissionProposalPayload | null {
    const current = this.proposals.get(proposalId);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.proposals.set(proposalId, next);
    return next;
  }

  bindMissionMessage(messageId: string): void {
    this.activeMissionMessageId = messageId;
  }

  conversationId(): string | null {
    return this.activeConversationId;
  }

  missionMessageId(): string | null {
    return this.activeMissionMessageId;
  }

  async launchProposal(
    proposalId: string,
    projectId: string,
    requestOverride?: string,
  ): Promise<{ ok: true; missionId: string } | { ok: false; notice: string }> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return { ok: false, notice: 'Proposition introuvable.' };
    // Un double clic, ou une carte déjà refusée, ne lance jamais une seconde mission.
    if (proposal.status === 'launched') return { ok: false, notice: 'Cette mission est déjà lancée.' };
    if (proposal.status === 'declined') return { ok: false, notice: 'Cette proposition a été refusée.' };
    if (proposal.blockedMessage) return { ok: false, notice: proposal.blockedMessage };
    // Une autre mission a pu démarrer entre la proposition et le clic.
    if (this.missionBusy()) {
      return {
        ok: false,
        notice: 'Une mission est déjà en cours. Termine-la ou annule-la avant d’en lancer une autre.',
      };
    }
    if (proposal.codeModelMissing) {
      return {
        ok: false,
        notice: 'Aucun modèle Codeur configuré : choisis-en un dans Réglages → Développeur → Modèle de code.',
      };
    }
    const dev = this.deps.developer();
    if (!dev) return { ok: false, notice: 'Le mode Développeur est coupé.' };
    // Réservé juste avant de démarrer : un second clic pendant le démarrage voit « déjà lancée ».
    this.patchProposal(proposalId, { status: 'launched' });
    const request = (requestOverride ?? proposal.objectif).trim();
    let state: Awaited<ReturnType<DeveloperController['startMission']>>;
    try {
      state = await dev.startMission(proposal.kind, request, false, projectId);
    } catch (error) {
      this.patchProposal(proposalId, { status: 'pending' });
      throw error;
    }
    const missionId = state.mission?.id;
    if (!missionId || (state.notice && !state.mission)) {
      this.patchProposal(proposalId, { status: 'pending' });
      return { ok: false, notice: state.notice ?? 'La mission n’a pas pu démarrer.' };
    }
    this.patchProposal(proposalId, { status: 'launched', missionId, projectId });
    this.linkedMissionId = missionId;
    return { ok: true, missionId };
  }

  declineProposal(proposalId: string): void {
    this.patchProposal(proposalId, { status: 'declined' });
  }

  private linkedMissionId: string | null = null;

  activeMissionId(): string | null {
    return this.linkedMissionId ?? this.deps.developer()?.state().mission?.id ?? null;
  }
}
