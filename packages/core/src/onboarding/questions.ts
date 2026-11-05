import type { OnboardingQuestion } from './types.js';

/** Questionnaire d’accueil 5.0.70 — une question par écran. */
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: 'window',
    title: 'Comment tu préfères ouvrir Jarvis ?',
    subtitle: 'Tu pourras changer dans les réglages.',
    kind: 'single',
    options: [
      { id: 'compact', label: 'Petite fenêtre', hint: 'Overlay rapide, raccourci clavier.' },
      { id: 'dashboard', label: 'Tableau de bord', hint: 'Vue large avec raccourcis.' },
    ],
  },
  {
    id: 'voice',
    title: 'Tu veux parler à Jarvis ?',
    kind: 'toggle',
    skippable: true,
  },
  {
    id: 'model',
    title: 'Tu préfères quel modèle ?',
    subtitle: 'Ollama reste gratuit sur ton PC.',
    kind: 'single',
    options: [
      { id: 'ollama', label: 'Ollama sur ce PC', hint: 'Local, sans clé API.' },
      { id: 'cloud', label: 'Un service en ligne', hint: 'OpenAI, Anthropic… avec clé.' },
    ],
    skippable: true,
  },
  {
    id: 'orchestra',
    title: 'Activer le chef d’orchestre ?',
    subtitle: 'Plusieurs petits modèles spécialisés pour les réponses longues.',
    kind: 'toggle',
    skippable: true,
  },
  {
    id: 'services',
    title: 'Quels services tu utilises souvent ?',
    kind: 'multi',
    options: [
      { id: 'google', label: 'Google (mail, agenda)' },
      { id: 'spotify', label: 'Spotify' },
      { id: 'developer', label: 'Créer des apps (développeur)' },
      { id: 'robot', label: 'Robot' },
      { id: 'phone', label: 'Jarvis sur le téléphone' },
    ],
    skippable: true,
  },
  {
    id: 'persona',
    title: 'Donner un caractère à Jarvis ?',
    subtitle: 'Ton plus vivant ; nécessite le chef d’orchestre.',
    kind: 'toggle',
    skippable: true,
  },
];
