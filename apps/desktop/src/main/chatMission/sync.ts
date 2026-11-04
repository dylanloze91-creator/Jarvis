import {
  trackFromMission,
  withMessages,
  type ChatMissionEnvelope,
  type ConversationStore,
} from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';
import type { CodeTaskState, DeveloperState } from '../../shared/developerIpc.js';
import type { ChatMissionHub } from './hub.js';

export interface ChatMissionSyncDeps {
  hub: ChatMissionHub;
  store: ConversationStore;
  pushEvent: (event: ChatEvent) => void;
}

/** Met à jour les messages de discussion quand l'état Développeur avance (5.0.68). */
export class ChatMissionSync {
  constructor(private readonly deps: ChatMissionSyncDeps) {}

  async onDeveloperState(state: DeveloperState): Promise<void> {
    const conversationId = this.deps.hub.conversationId();
    const messageId = this.deps.hub.missionMessageId();
    if (!conversationId || !messageId) return;

    const mission = state.mission;
    let envelope: ChatMissionEnvelope | null = null;
    if (mission && (mission.status === 'running' || mission.status === 'task' || mission.status === 'waiting-answers')) {
      envelope = { kind: 'track', data: trackFromMission(mission) };
    } else if (mission && (mission.status === 'finished' || mission.status === 'failed' || mission.status === 'cancelled')) {
      const report = state.codeTask?.report?.markdown ?? mission.summary ?? '';
      if (report || state.codeTask) {
        envelope = {
          kind: 'report',
          data: reportEnvelope(mission.id, mission.projectId, state.codeTask, report),
        };
      } else {
        envelope = { kind: 'track', data: trackFromMission(mission) };
      }
    }

    if (!envelope) return;
    await this.patchMessage(conversationId, messageId, envelope, mission?.id);
  }

  private async patchMessage(
    conversationId: string,
    messageId: string,
    envelope: ChatMissionEnvelope,
    missionId?: string,
  ): Promise<void> {
    const conversation = await this.deps.store.get(conversationId);
    if (!conversation) return;
    const messages = conversation.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            chatMission: envelope,
            ...(missionId ? { missionId } : {}),
          }
        : message,
    );
    await this.deps.store.save(withMessages(conversation, messages));
    this.deps.pushEvent({ type: 'mission_update', conversationId, messageId, envelope });
  }
}

function reportEnvelope(
  missionId: string,
  projectId: string,
  task: CodeTaskState | null,
  markdown: string,
): Extract<ChatMissionEnvelope, { kind: 'report' }>['data'] {
  return {
    missionId,
    projectId,
    markdown,
    worktreePath: task?.worktreePath ?? null,
    taskClosed: task?.closed ?? null,
    applied: Boolean(task?.applied && !task.applied.revertedAt),
  };
}
