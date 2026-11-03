import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings.js';

describe('homeLocation — réglages figés', () => {
  it('parseSettings({}) ne contient pas homeLocation', () => {
    expect(parseSettings({})).not.toHaveProperty('homeLocation');
  });

  it('accepte un lieu enregistré', () => {
    const parsed = parseSettings({
      homeLocation: { label: 'Ville Exemple', latitude: 48.1, longitude: -1.7 },
    });
    expect(parsed.homeLocation?.label).toBe('Ville Exemple');
  });
});
