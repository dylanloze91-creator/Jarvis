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
import type { FacileCoordinator } from './facile.js';

export interface ChatMissionIpcDeps {
  hub: () => ChatMissionHub | null;
  sync: () => ChatMissionSync | null;
  store: ConversationStore;
  pushEvent: (event: ChatEvent) => void;
  openMission: (missionId: string, projectId?: string) => Promise<void>;
  missionWorktree: () => string | null;
  /** Développeur facile (Jarvis Test). Absent : les trois canaux ne font rien. */
  facile?: () => FacileCoordinator | null;
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

  // Développeur facile : le choix sous « Ça existe déjà », la réponse à une question, le dossier.
  ipcMain.handle(IpcChannel.chatFacileChoice, async (_event, input: unknown) => {
    const choice = (input as { choice?: unknown } | null)?.choice;
    if (choice !== 'construire' && choice !== 'voir' && choice !== 'changer') return;
    await deps.facile?.()?.choose(choice);
  });

  ipcMain.handle(IpcChannel.chatFacileAnswer, (_event, input: unknown) => {
    const text = (input as { text?: unknown } | null)?.text;
    if (typeof text !== 'string') return;
    deps.facile?.()?.answer(text.slice(0, 500));
  });

  ipcMain.handle(IpcChannel.chatFacileOpenFolder, async () => {
    // Seul le dossier du projet que Jarvis vient de créer : aucun chemin ne vient de la fenêtre.
    const folder = deps.facile?.()?.current()?.folder;
    if (folder) await shell.openPath(folder);
  });

  ipcMain.handle(IpcChannel.chatFacileOpenApp, async () => {
    // Seulement la création affichée, et seulement si elle est prête : aucun projet ne vient de la fenêtre.
    await deps.facile?.()?.openApp();
  });

  ipcMain.handle(IpcChannel.chatMissionReload, async (_event, conversationId: unknown) => {
    const id = typeof conversationId === 'string' ? conversationId : '';
    if (!id) return;
    const conversation = await deps.store.get(id);
    if (!conversation) return;
    // Développeur facile : une création restée « en cours » alors que Jarvis a été fermé (ou qu'une
    // autre a pris sa place) n'avance plus. La carte le dit au lieu de tourner sans fin.
    const facile = deps.facile?.() ?? null;
    let changed = false;
    const repaired = conversation.messages.map((message) => {
      const envelope = message.chatMission;
      if (envelope?.kind !== 'facile') return message;
      const open = envelope.data.status === 'travaille' || envelope.data.status === 'question';
      if (!open || facile?.current()?.id === envelope.data.id) return message;
      changed = true;
      const stopped: ChatMissionEnvelope = {
        kind: 'facile',
        data: {
          ...envelope.data,
          status: 'arrete',
          question: null,
          result: 'Je me suis arrêté avant la fin (Jarvis a été fermé, ou une autre création a commencé). Ce qui est fait reste dans son dossier.',
        },
      };
      deps.pushEvent({ type: 'mission_update', conversationId: id, messageId: message.id, envelope: stopped });
      return { ...message, chatMission: stopped };
    });
    if (changed) await deps.store.save(withMessages(conversation, repaired));
    for (const message of conversation.messages) {
      // La carte d'une création se relit telle quelle : elle n'ouvre pas la mission dans le panneau.
      if (message.chatMission?.kind === 'facile') continue;
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
