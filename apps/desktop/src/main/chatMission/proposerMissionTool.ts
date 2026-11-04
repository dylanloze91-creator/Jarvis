import {
  PROPOSER_MISSION_TOOL_NAME,
  proposerMissionSchema,
  defineTool,
  toolSuccess,
  type RegisteredTool,
} from '@jarvis/core';
import type { ChatMissionHub } from './hub.js';

export function createProposerMissionTool(hub: ChatMissionHub): RegisteredTool {
  return defineTool({
    name: PROPOSER_MISSION_TOOL_NAME,
    description:
      'Proposer une mission Jarvis Développeur dans la discussion. Ne démarre rien : l’utilisateur valide sur la carte.',
    risk: 'safe',
    schema: proposerMissionSchema,
    summarize: (input) => `Mission proposée : ${input.objectif.slice(0, 80)}`,
    execute: async (input) => {
      const recorded = hub.recordProposal(input);
      return toolSuccess('Mission proposée dans la discussion.', recorded.payload);
    },
  });
}
