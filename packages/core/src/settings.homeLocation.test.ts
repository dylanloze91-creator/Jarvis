import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings.js';

describe('homeLocation — réglages figés', () => {
  it('parseSettings({}) ne contient pas homeLocation', () => {
    expect(parseSettings({})).not.toHaveProperty('homeLocation');
  });

  it('5.0.69 : parseSettings({}) ne contient ni spotifyDeviceName ni spotifySpeakerMaxVolume', () => {
    const parsed = parseSettings({});
    expect(parsed).not.toHaveProperty('spotifyDeviceName');
    expect(parsed).not.toHaveProperty('spotifySpeakerMaxVolume');
    expect(parseSettings({ spotifyDeviceName: 'Devialet', spotifySpeakerMaxVolume: 60 })).toMatchObject({
      spotifyDeviceName: 'Devialet',
      spotifySpeakerMaxVolume: 60,
    });
  });

  it('accepte un lieu enregistré', () => {
    const parsed = parseSettings({
      homeLocation: { label: 'Ville Exemple', latitude: 48.1, longitude: -1.7 },
    });
    expect(parsed.homeLocation?.label).toBe('Ville Exemple');
  });
});
