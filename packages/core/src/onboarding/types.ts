import type { PersonalizationProfile } from '../personalization/types.js';
import type { Settings } from '../settings.js';
import type { QuestionnaireSettingsBackup } from './questionnaireBackup.js';

export type WindowPreference = 'compact' | 'dashboard';

export type OnboardingQuestionKind = 'text' | 'single' | 'multi';

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
  /** Toutes les questions peuvent être passées sauf le prénom (facultatif aussi via Passer). */
  skippable?: boolean;
}

/** Identifiants des services (question 3). */
export const ONBOARDING_SERVICE_IDS = [
  'music',
  'google',
  'web',
  'pc',
  'focus',
  'code',
  'robot',
  'phone',
  'speakers',
] as const;

export type OnboardingServiceId = (typeof ONBOARDING_SERVICE_IDS)[number];

export type QuestionnaireAnswers = Record<string, string | string[] | undefined>;

export interface OnboardingEnvironment {
  /** Noms de modèles Ollama installés (vide si serveur absent). */
  ollamaModels: string[];
  /** La copie de travail Développeur est valide (validateRepo ok). */
  developerRepoValid: boolean;
  personalization: PersonalizationProfile;
}

export interface OnboardingChange {
  label: string;
  before: string;
  after: string;
}

export interface OnboardingPlanResult {
  changes: OnboardingChange[];
  patch: Partial<Settings>;
  personalization: Partial<PersonalizationProfile>;
  preferredServices: OnboardingServiceId[];
  windowPreference: WindowPreference;
  /** Après « C'est bon », ouvrir le tableau de bord si demandé. */
  openDashboard: boolean;
  /** Message d'aide si code choisi sans copie valide. */
  setupGuideHint: string | null;
}

export interface QuestionnaireState {
  answers: QuestionnaireAnswers;
  dismissed: boolean;
  completedAt: number | null;
  settingsBackup: QuestionnaireSettingsBackup | null;
  preferredServices: string[];
  windowPreference: WindowPreference;
}

export const emptyQuestionnaireState = (): QuestionnaireState => ({
  answers: {},
  dismissed: false,
  completedAt: null,
  settingsBackup: null,
  preferredServices: [...ONBOARDING_SERVICE_IDS],
  windowPreference: 'compact',
});
