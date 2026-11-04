import type { ChatMissionEnvelope } from '@jarvis/core';
import { ChatMissionProposalCard } from './ChatMissionProposalCard';
import { ChatMissionReportCard } from './ChatMissionReportCard';
import { ChatMissionTrackCard } from './ChatMissionTrackCard';

export function ChatMissionBlock({
  messageId,
  envelope,
  busy,
}: {
  messageId: string;
  envelope: ChatMissionEnvelope;
  busy: boolean;
}) {
  if (envelope.kind === 'notice') {
    return <p className="text-[12px] text-slate-400">{envelope.text}</p>;
  }
  if (envelope.kind === 'proposal') {
    return (
      <ChatMissionProposalCard
        data={envelope.data}
        busy={busy}
        onLaunch={(projectId, request) => {
          void window.jarvis.chat.launchMissionProposal({
            messageId,
            proposalId: envelope.data.proposalId,
            projectId,
            request,
          });
        }}
        onModify={(objectif) => {
          void window.jarvis.chat.patchMissionProposal({ messageId, proposalId: envelope.data.proposalId, objectif });
          const composer = document.querySelector<HTMLTextAreaElement>('[data-composer-input]');
          if (composer) {
            composer.value = objectif;
            composer.focus();
          }
        }}
        onDecline={() => {
          void window.jarvis.chat.declineMissionProposal({ messageId, proposalId: envelope.data.proposalId });
        }}
        onProjectChange={(projectId) => {
          void window.jarvis.chat.setMissionProposalProject({
            messageId,
            proposalId: envelope.data.proposalId,
            projectId,
          });
        }}
      />
    );
  }
  if (envelope.kind === 'track') {
    return (
      <ChatMissionTrackCard
        data={envelope.data}
        onAnswer={
          envelope.data.waitingQuestions.length
            ? (text) => {
                void window.jarvis.developer.answerMission([text]);
              }
            : undefined
        }
      />
    );
  }
  return (
    <ChatMissionReportCard
      data={envelope.data}
      busy={busy}
      onApply={() => void window.jarvis.developer.applyTask()}
      onOpenFolder={() =>
        void window.jarvis.chat.openMissionFolder({ messageId, missionId: envelope.data.missionId })
      }
      onKeep={() => void window.jarvis.developer.keepTask()}
      onDiscard={() => void window.jarvis.developer.discardTask()}
    />
  );
}
