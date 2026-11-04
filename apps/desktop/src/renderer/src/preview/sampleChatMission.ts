import { createMessage, type Conversation } from '@jarvis/core';
import type {
  ChatMissionProposalPayload,
  ChatMissionReportPayload,
  ChatMissionTrackPayload,
} from '@jarvis/core';

const SAMPLE_GATE: ChatMissionProposalPayload['gate'] = {
  ok: true,
  kind: 'modify',
  request: 'Ajoute un menu pause avec reprise au jeu de plateforme.',
  difficulty: { level: 2, template: null, items: [], reasons: ['fonction nouvelle'] },
  capability: {
    model: 'qwen2.5-coder:7b',
    level: 3,
    source: 'taille',
    coder: null,
    paramsB: 7,
    detail: 'Modèle coder 7B',
  },
  message: 'Le modèle peut tenir cette mission.',
  suggestion: null,
};

const baseUser = createMessage(
  'user',
  'Crée-moi un menu pause dans mon jeu de plateforme, avec reprise et retour au menu.',
);

function conv(id: string, title: string, extra: ReturnType<typeof createMessage>[]): Conversation {
  return {
    id,
    title,
    createdAt: 1,
    updatedAt: 2,
    messages: [baseUser, ...extra],
  };
}

export const SAMPLE_CHAT_MISSION_PROPOSAL: Conversation = conv('preview-mission-proposal', 'Menu pause', [
  createMessage('assistant', 'Je te propose une mission pour écrire le code sur ton PC.'),
  createMessage('assistant', '', {
    chatMission: {
      kind: 'proposal',
      data: {
        proposalId: 'preview-proposal',
        missionType: 'modifier',
        objectif: 'Ajoute un menu pause (Reprendre / Quitter) au jeu de plateforme existant.',
        launchObjectif:
          'Ajoute un menu pause (Reprendre / Quitter) au jeu de plateforme existant.',
        projetHint: 'mon-jeu',
        projectId: 'jarvis',
        kind: 'modify',
        codeModel: 'qwen2.5-coder:7b',
        codeModelMissing: false,
        gate: SAMPLE_GATE,
        status: 'pending',
      },
    },
  }),
]);

const TRACK: ChatMissionTrackPayload = {
  missionId: 'preview-mission-run',
  projectId: 'jarvis',
  kind: 'modify',
  request: 'Menu pause dans le jeu de plateforme',
  status: 'task',
  steps: [
    { id: 'goal', actor: 'REASONER', label: 'Objectif et questions', status: 'done' },
    { id: 'design', actor: 'ARCHITECT', label: 'Conception', status: 'done' },
    { id: 'plan', actor: 'CODER', label: 'Plan de modification', status: 'running', detail: 'index.html, game.js' },
    { id: 'tests', actor: 'JARVIS', label: 'Tests npm', status: 'pending' },
  ],
  waitingQuestions: [],
};

export const SAMPLE_CHAT_MISSION_TRACK: Conversation = conv('preview-mission-track', 'Mission en cours', [
  createMessage('assistant', '', {
    chatMission: { kind: 'track', data: TRACK },
  }),
]);

const REPORT: ChatMissionReportPayload = {
  missionId: 'preview-mission-run',
  projectId: 'jarvis',
  markdown:
    '## Résultat\n\n- Menu pause ajouté (touche Échap).\n- Tests npm : 12 passés, 0 échec.\n\nFichiers : `game.js`, `styles.css`.',
  worktreePath: 'C:\\dev\\Jarvis-taches\\menu-pause',
  taskClosed: null,
  applied: false,
};

export const SAMPLE_CHAT_MISSION_REPORT: Conversation = conv('preview-mission-report', 'Rapport mission', [
  createMessage('assistant', '', {
    chatMission: { kind: 'report', data: REPORT },
  }),
]);
