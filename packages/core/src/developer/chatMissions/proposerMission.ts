import { z } from 'zod';
import type { MissionKind } from '../engine/router.js';

export const PROPOSER_MISSION_TOOL_NAME = 'proposer_mission';

/** Types exposés au modèle Code (5.0.68). */
export const PROPOSER_MISSION_TYPES = [
  'modifier',
  'corriger',
  'nouveau-projet',
  'documenter',
] as const;

export type ProposerMissionType = (typeof PROPOSER_MISSION_TYPES)[number];

export const proposerMissionSchema = z.object({
  type: z.enum(PROPOSER_MISSION_TYPES),
  objectif: z.string().min(8).max(4000),
  projet: z.string().max(200).optional(),
});

export type ProposerMissionInput = z.infer<typeof proposerMissionSchema>;

export interface ProposerMissionPayload extends ProposerMissionInput {
  proposalId: string;
}

const TYPE_TO_KIND: Record<ProposerMissionType, MissionKind> = {
  modifier: 'modify',
  corriger: 'fix',
  'nouveau-projet': 'new-project',
  documenter: 'document',
};

export function missionKindFromProposerType(type: ProposerMissionType): MissionKind {
  return TYPE_TO_KIND[type];
}

/** Consigne courte pour l'équipe Code quand les missions depuis la discussion sont actives. */
export const CODE_MISSION_TOOL_PROMPT =
  'Si la demande veut des fichiers de code créés ou modifiés sur le PC (crée, ajoute, corrige un bug, fais un programme), appelle proposer_mission avec le type adapté et un objectif clair. ' +
  'Pour une simple explication ou un petit extrait de code dans la discussion, réponds normalement sans proposer_mission. ' +
  'N’écris jamais une mission en texte (Objectif, Projet, Type) : appelle proposer_mission, ou réponds normalement.';

export function proposerMissionToolSchema() {
  return {
    type: 'function' as const,
    function: {
      name: PROPOSER_MISSION_TOOL_NAME,
      description:
        'Proposer une mission Jarvis Développeur dans la discussion. Ne démarre rien : l’utilisateur valide sur la carte.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...PROPOSER_MISSION_TYPES] },
          objectif: { type: 'string', description: 'Objectif reformulé en français' },
          projet: { type: 'string', description: 'Nom ou id de projet si évident ; sinon omis' },
        },
        required: ['type', 'objectif'],
      },
    },
  };
}
