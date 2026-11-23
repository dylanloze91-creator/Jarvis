import { describe, expect, it } from 'vitest';
import { parseSpotifyVolumeCommand, steppedVolume } from './volumeIntent.js';

// Phrases écrites pour l'essai (24 novembre 2026), jamais celles de l'utilisateur.
describe('volume Spotify à la voix', () => {
  it('lit un volume chiffré', () => {
    const cases: Array<[string, number]> = [
      ['Mets le volume à 40', 40],
      ['Jarvis, volume à 30.', 30],
      ['Règle le volume sur 55 %', 55],
      ['Monte le volume à 60', 60],
      ['Baisse le son à 20 pour cent', 20],
      ['Mets le volume de l’enceinte à 50', 50],
      ['Volume de la musique à cinquante', 50],
      ['Mets le volume à fond', 100],
      ['Mets le son à 35 sur Spotify s’il te plaît', 35],
    ];
    for (const [text, percent] of cases) {
      expect(parseSpotifyVolumeCommand(text), text).toEqual({ kind: 'set', percent });
    }
  });

  it('lit plus fort et moins fort', () => {
    for (const text of [
      'Monte le volume',
      'Monte le son de l’enceinte',
      'Jarvis, plus fort',
      'Un peu plus fort s’il te plaît',
      'Augmente le volume de la musique',
      'Mets plus fort sur Spotify',
    ]) {
      expect(parseSpotifyVolumeCommand(text), text).toEqual({ kind: 'step', direction: 'up' });
    }
    for (const text of [
      'Baisse le volume',
      'Baisse un peu le son',
      'Moins fort',
      'Jarvis, baisse le son de l’enceinte',
      'Diminue le volume',
      'Parle moins fort',
    ]) {
      expect(parseSpotifyVolumeCommand(text), text).toEqual({ kind: 'step', direction: 'down' });
    }
  });

  it('laisse au modèle ce qui n’est pas le volume de la musique', () => {
    for (const text of [
      'Baisse le volume du PC',
      'Monte le son de la vidéo YouTube',
      'Qui est plus fort, Messi ou Ronaldo ?',
      'Mets le volume à 250',
      'Son nom est Paul',
      'Monte le volume de ma voiture et explique-moi comment marche un moteur',
      'Baisse le micro',
      'Plus fort que moi tu meurs',
      // Sans le son ni la musique, « baisse un peu » peut viser la lumière ou le chauffage.
      'Baisse un peu',
      'Monte un peu',
    ]) {
      expect(parseSpotifyVolumeCommand(text), text).toBeNull();
    }
  });

  it('borne le pas', () => {
    expect(steppedVolume(40, 'up')).toBe(50);
    expect(steppedVolume(5, 'down')).toBe(0);
    expect(steppedVolume(95, 'up')).toBe(100);
  });
});
