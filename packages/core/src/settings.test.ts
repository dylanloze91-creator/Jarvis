import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings } from './settings.js';

describe('parseSettings', () => {
  it('reprend l’ancien gabarit unique comme premier échantillon', () => {
    const settings = parseSettings({ voice: { wakeWordProfile: [0.1, 0.9, 0.3] } });
    expect(settings.voice.wakeWordProfiles).toEqual([[0.1, 0.9, 0.3]]);
  });

  it('laisse les échantillons multiples intacts', () => {
    const profiles = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];
    expect(parseSettings({ voice: { wakeWordProfiles: profiles } }).voice.wakeWordProfiles).toEqual(
      profiles,
    );
  });

  it('retombe sur les valeurs par défaut quand la configuration est illisible', () => {
    expect(parseSettings({ temperature: 'beaucoup' })).toEqual(defaultSettings);
    expect(parseSettings(null).voice.wakeWordProfiles).toEqual([]);
  });

  it('applique une sensibilité par défaut au milieu de la plage', () => {
    expect(defaultSettings.voice.wakeWordSensitivity).toBe(0.5);
  });
});
