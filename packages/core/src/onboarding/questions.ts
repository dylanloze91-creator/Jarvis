import type { OnboardingQuestion } from './types.js';

/** Questionnaire « Faisons connaissance » — une question par écran, libellés simples. */
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: 'firstName',
    title: 'Comment je t’appelle ?',
    subtitle: 'Ton prénom, pour te parler naturellement.',
    kind: 'text',
    skippable: true,
  },
  {
    id: 'talkMode',
    title: 'Tu me parles surtout…',
    kind: 'single',
    options: [
      { id: 'voice', label: 'À la voix', hint: 'Écoute et mot de réveil activés.' },
      { id: 'keyboard', label: 'Au clavier', hint: 'Sans écoute permanente.' },
      { id: 'both', label: 'Les deux', hint: 'Voix et clavier.' },
    ],
    skippable: true,
  },
  {
    id: 'services',
    title: 'Qu’est-ce que tu veux que je fasse pour toi ?',
    subtitle: 'Plusieurs choix possibles. Rien n’est branché automatiquement.',
    kind: 'multi',
    options: [
      { id: 'music', label: 'Musique' },
      { id: 'google', label: 'Mails et agenda' },
      { id: 'web', label: 'Recherches sur internet' },
      { id: 'pc', label: 'Ouvrir des applis et des fichiers' },
      { id: 'focus', label: 'M’aider à me concentrer' },
      { id: 'code', label: 'Code et projets' },
      { id: 'robot', label: 'Piloter le robot' },
      { id: 'phone', label: 'Me parler depuis le téléphone' },
      { id: 'speakers', label: 'Enceintes dans la maison' },
    ],
    skippable: true,
  },
  {
    id: 'character',
    title: 'Quel caractère tu préfères ?',
    kind: 'single',
    options: [
      { id: 'complice', label: 'Complice', hint: 'Chaleureux et franc.' },
      { id: 'majordome', label: 'Majordome', hint: 'Courtois et posé.' },
      { id: 'direct', label: 'Direct', hint: 'Sobre et efficace.' },
      { id: 'neutral', label: 'Neutre, sans personnage' },
    ],
    skippable: true,
  },
  {
    id: 'answerStyle',
    title: 'Tes réponses, plutôt…',
    kind: 'single',
    options: [
      { id: 'short', label: 'Courtes' },
      { id: 'detailed', label: 'Détaillées' },
    ],
    skippable: true,
  },
  {
    id: 'confirmBefore',
    title: 'Avant d’agir sur ton PC, je te demande…',
    kind: 'single',
    options: [
      { id: 'always', label: 'Toujours' },
      { id: 'risky', label: 'Seulement si c’est risqué' },
    ],
    skippable: true,
  },
  {
    id: 'orchestra',
    title: 'Tu veux que je sois plus malin ?',
    subtitle:
      'Je trie chaque demande et j’appelle le bon spécialiste — un peu plus lent au premier message.',
    kind: 'single',
    options: [
      { id: 'yes', label: 'Oui, active le chef d’orchestre' },
      { id: 'no', label: 'Non, garde comme aujourd’hui' },
    ],
    skippable: true,
  },
  {
    id: 'windowLayout',
    title: 'Ta fenêtre, plutôt…',
    kind: 'single',
    options: [
      { id: 'compact', label: 'Petite fenêtre' },
      { id: 'dashboard', label: 'Grand tableau de bord' },
    ],
    skippable: true,
  },
  {
    id: 'alwaysOnTop',
    title: 'Tu veux que je reste visible au-dessus des autres fenêtres ?',
    kind: 'single',
    options: [
      { id: 'yes', label: 'Oui' },
      { id: 'no', label: 'Non' },
    ],
    skippable: true,
  },
];
