import type { Settings } from '../settings.js';

export type WindowPreference = 'compact' | 'dashboard';

export type OnboardingQuestionKind = 'single' | 'multi' | 'toggle';

export interface OnboardingOption {
  id: string;
  label: string;
  hint?: string;
}

export interface OnboardingQuestion {
  id: string;
  title: string;
  subtitle?: string;
  kind: OnboardingQuestionKind;
  options?: OnboardingOption[];
  skippable?: boolean;
}

/** Réponses brutes du questionnaire (ids de question → valeur). */
export type QuestionnaireAnswers = Record<string, string | boolean | string[] | undefined>;

export interface QuestionnaireState {
  answers: QuestionnaireAnswers;
  dismissed: boolean;
  completedAt: number | null;
  /** Instantané partiel des réglages avant « Appliquer », pour revenir en arrière. */
  settingsBackup: Partial<Settings> | null;
  /** Ordre d’affichage des raccourcis services (Spotify, Google…). */
  preferredServices: string[];
  windowPreference: WindowPreference;
}

export const emptyQuestionnaireState = (): QuestionnaireState => ({
  answers: {},
  dismissed: false,
  completedAt: null,
  settingsBackup: null,
  preferredServices: ['google', 'spotify', 'developer'],
  windowPreference: 'compact',
});
