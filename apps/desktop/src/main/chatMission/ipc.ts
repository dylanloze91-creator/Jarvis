import { shell } from 'electron';
import {
  NEW_PROJECT_SCOPE,
  withMessages,
  type ChatMissionEnvelope,
  type ConversationStore,
} from '@jarvis/core';
import { IpcChannel, type ChatEvent } from '../../shared/ipc.js';
import type { IpcMain } from 'electron';
import type { ChatMissionHub } from './hub.js';
import type { ChatMissionSync } from './sync.js';

export interface ChatMissionIpcDeps {
  hub: () => ChatMissionHub | null;
  sync: () => ChatMissionSync | null;
  store: ConversationStore;
  pushEvent: (event: ChatEvent) => void;
  openMission: (missionId: string, projectId?: string) => Promise<void>;
  missionWorktree: () => string | null;
}

function projectScope(id: string): string {
  return id === 'new-project' ? NEW_PROJECT_SCOPE : id;
}

export function registerChatMissionIpc(ipcMain: IpcMain, deps: ChatMissionIpcDeps): void {
  ipcMain.handle(
    IpcChannel.chatMissionLaunch,
    async (_event, input: unknown) => {
      const hub = deps.hub();
      if (!hub) return;
      const payload = input as {
        messageId?: string;
        proposalId?: string;
        projectId?: string;
        request?: string;
      };
      const proposalId = typeof payload.proposalId === 'string' ? payload.proposalId : '';
      const projectId = projectScope(typeof payload.projectId === 'string' ? payload.projectId : '');
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
      const request = typeof payload.request === 'string' ? payload.request : undefined;
      const result = await hub.launchProposal(proposalId, projectId, request);
      if (!result.ok) {
        await patchEnvelope(deps, messageId, { kind: 'notice', text: result.notice });
        return;
      }
      hub.bindMissionMessage(messageId);
    },
  );

  ipcMain.handle(IpcChannel.chatMissionDecline, async (_event, input: unknown) => {
    const hub = deps.hub();
    if (!hub) return;
    const payload = input as { messageId?: string; proposalId?: string };
    const proposalId = typeof payload.proposalId === 'string' ? payload.proposalId : '';
    hub.declineProposal(proposalId);
    const proposal = hub.getProposal(proposalId);
    if (proposal && payload.messageId) {
      await patchEnvelope(deps, payload.messageId, { kind: 'proposal', data: proposal });
    }
  });

  ipcMain.handle(IpcChannel.chatMissionSetProject, async (_event, input: unknown) => {
    const hub = deps.hub();
    if (!hub) return;
    const payload = input as { messageId?: string; proposalId?: string; projectId?: string };
    const proposalId = typeof payload.proposalId === 'string' ? payload.proposalId : '';
    const projectId = typeof payload.projectId === 'string' ? payload.projectId : null;
    const next = hub.patchProposal(proposalId, { projectId });
    if (next && payload.messageId) {
      await patchEnvelope(deps, payload.messageId, { kind: 'proposal', data: next });
    }
  });

  ipcMain.handle(IpcChannel.chatMissionPatchProposal, async (_event, input: unknown) => {
    const hub = deps.hub();
    if (!hub) return;
    const payload = input as { messageId?: string; proposalId?: string; objectif?: string };
    const proposalId = typeof payload.proposalId === 'string' ? payload.proposalId : '';
    const objectif = typeof payload.objectif === 'string' ? payload.objectif.trim() : '';
    if (!objectif) return;
    const next = hub.patchProposal(proposalId, { objectif });
    if (next && payload.messageId) {
      await patchEnvelope(deps, payload.messageId, { kind: 'proposal', data: next });
    }
  });

  ipcMain.handle(IpcChannel.chatMissionOpenFolder, async () => {
    const path = deps.missionWorktree();
    if (path) await shell.openPath(path);
  });

  ipcMain.handle(IpcChannel.chatMissionReload, async (_event, conversationId: unknown) => {
    const id = typeof conversationId === 'string' ? conversationId : '';
    if (!id) return;
    const conversation = await deps.store.get(id);
    if (!conversation) return;
    for (const message of conversation.messages) {
      if (message.missionId && message.chatMission?.kind !== 'proposal') {
        const projectId =
          message.chatMission?.kind === 'track'
            ? message.chatMission.data.projectId
            : message.chatMission?.kind === 'report'
              ? message.chatMission.data.projectId
              : undefined;
        await deps.openMission(message.missionId, projectId);
      }
    }
  });
}

async function patchEnvelope(
  deps: ChatMissionIpcDeps,
  messageId: string,
  envelope: ChatMissionEnvelope,
): Promise<void> {
  if (!messageId) return;
  const hub = deps.hub();
  const conversationId = hub?.conversationId();
  if (!conversationId) return;
  const conversation = await deps.store.get(conversationId);
  if (!conversation) return;
  const messages = conversation.messages.map((message) =>
    message.id === messageId ? { ...message, chatMission: envelope } : message,
  );
  await deps.store.save(withMessages(conversation, messages));
  deps.pushEvent({ type: 'mission_update', conversationId, messageId, envelope });
}
