import type { PersonalizationProfile } from '../personalization/types.js';
import { parseSettings, type Settings } from '../settings.js';
import type { QuestionnaireAnswers, QuestionnaireState } from './types.js';

/** Clés réglages sauvegardées avant application du questionnaire. */
export const QUESTIONNAIRE_BACKUP_SETTING_KEYS = [
  'voice',
  'persona',
  'orchestra',
  'developer',
  'toolPolicies',
  'stayVisibleOnBlur',
] as const satisfies readonly (keyof Settings)[];

export type QuestionnaireBackupSettingKey = (typeof QUESTIONNAIRE_BACKUP_SETTING_KEYS)[number];

export interface QuestionnaireSettingsBackup {
  values: Partial<Settings>;
  /** Clés absentes de `settings.json` avant le questionnaire (à supprimer à la restauration). */
  absentKeys: QuestionnaireBackupSettingKey[];
  personalization: PersonalizationProfile;
}

export function isQuestionnaireSettingsBackup(value: unknown): value is QuestionnaireSettingsBackup {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.values === 'object' &&
    record.values !== null &&
    Array.isArray(record.absentKeys) &&
    typeof record.personalization === 'object' &&
    record.personalization !== null
  );
}

/** Sauvegarde avant « C'est bon » : valeurs présentes + clés réellement absentes + personnalisation. */
export function questionnaireSettingsBackup(
  settings: Settings,
  personalization: PersonalizationProfile,
): QuestionnaireSettingsBackup {
  const values: Partial<Settings> = {};
  const absentKeys: QuestionnaireBackupSettingKey[] = [];
  for (const key of QUESTIONNAIRE_BACKUP_SETTING_KEYS) {
    const value = settings[key];
    if (value === undefined) absentKeys.push(key);
    else (values as Record<string, unknown>)[key] = structuredClone(value);
  }
  return {
    values,
    absentKeys,
    personalization: structuredClone(personalization),
  };
}

/** Réapplique la sauvegarde et supprime les clés qui n'existaient pas avant le questionnaire. */
export function questionnaireSettingsRestore(
  current: Settings,
  backup: QuestionnaireSettingsBackup,
): Settings {
  const merged: Record<string, unknown> = { ...current, ...backup.values };
  for (const key of backup.absentKeys) {
    delete merged[key];
  }
  return parseSettings(merged, current);
}

/** IPC `questionnaire:set` — seules les réponses et le « Passer » sont acceptés. */
export function sanitizeQuestionnaireSetPatch(
  patch: unknown,
): Partial<Pick<QuestionnaireState, 'answers' | 'dismissed'>> {
  if (typeof patch !== 'object' || patch === null) return {};
  const record = patch as Record<string, unknown>;
  const out: Partial<Pick<QuestionnaireState, 'answers' | 'dismissed'>> = {};
  if (typeof record.answers === 'object' && record.answers !== null && !Array.isArray(record.answers)) {
    out.answers = { ...(record.answers as QuestionnaireAnswers) };
  }
  if (record.dismissed === true || record.dismissed === false) {
    out.dismissed = record.dismissed;
  }
  return out;
}

/** Ancien format (Partial<Settings> seul) → nouveau backup sans absentKeys ni personnalisation. */
export function normalizeQuestionnaireSettingsBackup(
  raw: unknown,
  fallbackPersonalization: PersonalizationProfile,
): QuestionnaireSettingsBackup | null {
  if (raw === null || raw === undefined) return null;
  if (isQuestionnaireSettingsBackup(raw)) return structuredClone(raw);
  if (typeof raw === 'object') {
    return {
      values: structuredClone(raw as Partial<Settings>),
      absentKeys: [],
      personalization: structuredClone(fallbackPersonalization),
    };
  }
  return null;
}
