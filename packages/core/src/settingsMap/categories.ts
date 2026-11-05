/** Catégories des réglages 5.0.70 (interface simple). */
export type SettingsCategoryId = 'moi' | 'parler' | 'services' | 'brain' | 'security' | 'application';

export const SETTINGS_CATEGORY_IDS: SettingsCategoryId[] = [
  'moi',
  'parler',
  'services',
  'brain',
  'security',
  'application',
];

export const SETTINGS_CATEGORY_LABELS: Record<SettingsCategoryId, string> = {
  moi: 'Moi',
  parler: 'Parler',
  services: 'Services',
  brain: 'Cerveau',
  security: 'Sécurité',
  application: 'Application',
};
