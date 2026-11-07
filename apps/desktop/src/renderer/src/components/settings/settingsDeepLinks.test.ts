import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS } from '@/components/SettingsTabs';
import { SETTINGS_DEEP_LINKS } from './settingsDeepLinks';

describe('SETTINGS_DEEP_LINKS', () => {
  it('couvre chaque ancien onglet', () => {
    for (const tab of SETTINGS_TABS) {
      expect(SETTINGS_DEEP_LINKS[tab.id]).toBeTruthy();
    }
    expect(SETTINGS_DEEP_LINKS.developer.category).toBe('services');
  });
});
