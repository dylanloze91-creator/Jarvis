import type { SettingsCategoryId } from '@jarvis/core';
import type { SettingsTabId } from '@/components/SettingsTabs';

export interface SettingsNavigationTarget {
  category: SettingsCategoryId;
  subcategory: string;
  highlight?: string;
}

/** Anciens onglets → nouvelle arborescence (5.0.70). */
export const SETTINGS_DEEP_LINKS: Record<SettingsTabId, SettingsNavigationTarget> = {
  voice: { category: 'parler', subcategory: 'voice' },
  model: { category: 'brain', subcategory: 'provider' },
  search: { category: 'brain', subcategory: 'search' },
  spotify: { category: 'services', subcategory: 'spotify' },
  google: { category: 'services', subcategory: 'google' },
  robot: { category: 'services', subcategory: 'robot' },
  phone: { category: 'services', subcategory: 'phone' },
  speakers: { category: 'services', subcategory: 'speakers' },
  tools: { category: 'security', subcategory: 'tool-policies' },
  general: { category: 'application', subcategory: 'window' },
  updates: { category: 'application', subcategory: 'updates' },
  developer: { category: 'services', subcategory: 'developer-advanced' },
};

/** Liens dédiés (hors anciens onglets). */
export const SETTINGS_SPECIAL_LINKS = {
  persona: { category: 'moi', subcategory: 'persona' } satisfies SettingsNavigationTarget,
  knowledge: { category: 'moi', subcategory: 'knowledge' } satisfies SettingsNavigationTarget,
  orchestra: { category: 'brain', subcategory: 'orchestra' } satisfies SettingsNavigationTarget,
  audit: { category: 'security', subcategory: 'audit' } satisfies SettingsNavigationTarget,
  questionnaire: { category: 'application', subcategory: 'questionnaire' } satisfies SettingsNavigationTarget,
} as const;
