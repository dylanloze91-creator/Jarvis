import { DEFAULT_PERSONA } from '../agent/persona.js';
import type { Settings } from '../settings.js';
import type { QuestionnaireAnswers, WindowPreference } from './types.js';

const BACKUP_KEYS: (keyof Settings)[] = [
  'provider',
  'model',
  'orchestra',
  'persona',
  'voice',
  'developer',
  'stayVisibleOnBlur',
];

/** Champs à sauvegarder avant d’appliquer le questionnaire (rollback). */
export function questionnaireSettingsBackup(settings: Settings): Partial<Settings> {
  const backup: Partial<Settings> = {};
  for (const key of BACKUP_KEYS) {
    const value = settings[key];
    if (value !== undefined) {
      (backup as Record<string, unknown>)[key] = structuredClone(value);
    }
  }
  return backup;
}

export interface QuestionnaireApplyResult {
  patch: Partial<Settings>;
  preferredServices: string[];
  windowPreference: WindowPreference;
}

/** Traduit les réponses en patch de réglages (sans écrire sur disque). */
export function applyQuestionnaireAnswers(
  settings: Settings,
  answers: QuestionnaireAnswers,
): QuestionnaireApplyResult {
  const patch: Partial<Settings> = {};
  let preferredServices = ['google', 'spotify', 'developer'];
  let windowPreference: WindowPreference = 'compact';

  const window = answers.window;
  if (window === 'compact' || window === 'dashboard') {
    windowPreference = window;
    if (window === 'dashboard') patch.stayVisibleOnBlur = true;
  }

  if (answers.voice === true) {
    patch.voice = { ...settings.voice, enabled: true };
  } else if (answers.voice === false) {
    patch.voice = { ...settings.voice, enabled: false };
  }

  const model = answers.model;
  if (model === 'ollama') {
    patch.provider = 'ollama';
    if (!settings.model || settings.provider !== 'ollama') {
      patch.model = settings.model || 'qwen2.5:3b';
    }
  } else if (model === 'cloud' && settings.provider === 'ollama') {
    patch.provider = 'mock';
  }

  if (answers.orchestra === true && (patch.provider === 'ollama' || settings.provider === 'ollama')) {
    const brain = settings.orchestra?.brain?.trim() || settings.model || 'qwen2.5:3b';
    patch.orchestra = { ...(settings.orchestra ?? { enabled: false, brain }), enabled: true, brain };
  } else if (answers.orchestra === false && settings.orchestra) {
    patch.orchestra = { ...settings.orchestra, enabled: false };
  }

  if (answers.persona === true) {
    patch.persona = { ...(settings.persona ?? DEFAULT_PERSONA), enabled: true };
  } else if (answers.persona === false) {
    patch.persona = { ...(settings.persona ?? DEFAULT_PERSONA), enabled: false };
  }

  const services = answers.services;
  if (Array.isArray(services) && services.every((item) => typeof item === 'string')) {
    preferredServices = services;
    if (services.includes('developer')) {
      patch.developer = { ...settings.developer, enabled: true };
    }
  }

  return { patch, preferredServices, windowPreference };
}
