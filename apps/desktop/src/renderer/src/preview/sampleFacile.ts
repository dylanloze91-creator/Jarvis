import { FACILE_IMMEDIATE_REPLY, createMessage, type Conversation, type FacilePayload } from '@jarvis/core';

/**
 * Scènes d'aperçu de Jarvis Développeur facile (`?scene=developer-facile-1` à `-5`), les cinq
 * écrans validés : tout de suite, ce que j'ai trouvé, il construit et raconte, une question à la
 * fois, c'est prêt. Les applications citées sont des exemples inventés (domaines `.example`) :
 * dans Jarvis, seuls de vrais résultats de recherche s'affichent.
 */
const DEMANDE = 'Fais-moi une petite appli pour noter mes heures de chantier';
const now = Date.now();

const BASE: FacilePayload = {
  id: 'apercu-creation',
  missionId: null,
  projectId: null,
  objectif: DEMANDE,
  restatement: 'Si j’ai bien compris : une petite appli pour noter mes heures de chantier.',
  startedAt: now - 4_000,
  status: 'travaille',
  findings: {
    state: 'cherche',
    existing: [],
    method: 'Je pars d’une page qui s’ouvre dans le navigateur, avec des écrans simples, et j’y ajoute ce que tu demandes.',
  },
  lines: [{ id: 'scaffold', text: 'Je prépare le dossier du projet…', state: 'en-cours', startedAt: now - 3_000 }],
  files: [],
  folder: null,
  question: null,
  answers: [],
  result: null,
  voice: false,
};

const TROUVE: FacilePayload['findings'] = {
  state: 'trouve',
  existing: [
    {
      name: 'Heures Pro (exemple)',
      phrase: 'Note les heures de chantier depuis le téléphone, gratuit pour une personne.',
      url: 'https://heurespro.example/',
      site: 'heurespro.example',
    },
    {
      name: 'Chrono Chantier (exemple)',
      phrase: 'Un minuteur par chantier, avec un total par semaine.',
      url: 'https://chrono-chantier.example/',
      site: 'chrono-chantier.example',
    },
  ],
  method: BASE.findings.method,
};

const FOLDER = 'C:\\dev\\Projets\\heures-de-chantier';

const SCENES: Record<string, FacilePayload> = {
  'developer-facile-1': BASE,
  'developer-facile-2': {
    ...BASE,
    missionId: '2026-11-19-exemple',
    startedAt: now - 21_000,
    findings: TROUVE,
    folder: FOLDER,
    lines: [
      { id: 'supervisor', text: 'Je sais par où commencer.', state: 'fait' },
      { id: 'scaffold', text: 'Le dossier du projet est prêt.', state: 'fait' },
      { id: 'design', text: 'Je choisis la base qui convient…', state: 'en-cours', startedAt: now - 6_000 },
    ],
  },
  'developer-facile-3': {
    ...BASE,
    missionId: '2026-11-19-exemple',
    projectId: 'heures-de-chantier',
    startedAt: now - 185_000,
    findings: { ...TROUVE, choice: 'construire' },
    folder: FOLDER,
    files: ['index.html', 'src/main.ts', 'src/heures.ts', 'src/heures.test.ts'],
    lines: [
      { id: 'supervisor', text: 'Je sais par où commencer.', state: 'fait' },
      { id: 'scaffold', text: 'Le dossier du projet est prêt.', state: 'fait' },
      { id: 'create', text: 'La base de l’application est posée.', state: 'fait' },
      { id: 'edit-1', text: 'J’ai écrit 4 fichiers.', state: 'fait' },
      { id: 'test-1', text: 'Un essai ne marche pas, je regarde pourquoi.', state: 'rate' },
      { id: 'fix-1', text: 'Je corrige…', state: 'en-cours', startedAt: now - 48_000 },
    ],
  },
  'developer-facile-4': {
    ...BASE,
    missionId: '2026-11-19-exemple',
    projectId: 'heures-de-chantier',
    startedAt: now - 95_000,
    status: 'question',
    findings: { ...TROUVE, choice: 'construire' },
    folder: FOLDER,
    files: ['index.html', 'src/main.ts'],
    lines: [
      { id: 'scaffold', text: 'Le dossier du projet est prêt.', state: 'fait' },
      { id: 'create', text: 'La base de l’application est posée.', state: 'fait' },
    ],
    answers: [{ question: 'Une seule personne, ou toute l’équipe ?', answer: 'Juste moi', parDefaut: false }],
    question: {
      text: 'Tu veux voir le total par jour, ou par semaine ?',
      defaut: 'Fais au plus simple.',
      askedAt: now - 20_000,
      index: 2,
      total: 2,
    },
  },
  'developer-facile-5': {
    ...BASE,
    missionId: '2026-11-19-exemple',
    projectId: 'heures-de-chantier',
    startedAt: now - 412_000,
    status: 'pret',
    findings: { ...TROUVE, choice: 'construire' },
    folder: FOLDER,
    files: ['index.html', 'src/main.ts', 'src/heures.ts', 'src/heures.test.ts'],
    lines: [
      { id: 'scaffold', text: 'Le dossier du projet est prêt.', state: 'fait' },
      { id: 'create', text: 'La base de l’application est posée.', state: 'fait' },
      { id: 'edit-1', text: 'J’ai écrit 4 fichiers.', state: 'fait' },
      { id: 'test-1', text: 'Les essais marchent.', state: 'fait' },
      { id: 'review-1', text: 'J’ai relu mon travail.', state: 'fait' },
    ],
    result: 'C’est prêt. Tout est dans le dossier du projet.',
  },
};

export const FACILE_SCENES = Object.keys(SCENES);

export function sampleFacileConversation(scene: string): Conversation | null {
  const data = SCENES[scene];
  if (!data) return null;
  return {
    id: `apercu-${scene}`,
    title: 'Heures de chantier',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      createMessage('user', DEMANDE),
      createMessage('assistant', FACILE_IMMEDIATE_REPLY),
      createMessage('assistant', '', { chatMission: { kind: 'facile', data } }),
    ],
  };
}
