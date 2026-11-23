/**
 * 23 novembre 2026 : « mets de la musique (sur …) » reprend la lecture Spotify sans modèle, sur la
 * cible dite. Phrases écrites pour ces essais.
 */
import { describe, expect, it } from 'vitest';
import { extractSpotifyPlayQuery, genericMusicRequest, isMusicIntent } from './playIntent.js';

describe('musique sans morceau', () => {
  it.each([
    ['Lance un peu de musique', null],
    ['mets la musique', null],
    ['Tu peux mettre de la musique ?', null],
    ['Jarvis, mets de la musique sur l’ordinateur', { kind: 'pc' }],
    ['Mets de la musique sur mon PC', { kind: 'pc' }],
    ['Joue de la musique sur l’enceinte stp', { kind: 'speaker' }],
    ['Lance la musique sur la Sonos', { kind: 'named', name: 'Sonos' }],
  ])('« %s » → reprise, cible %j', (phrase, hint) => {
    expect(genericMusicRequest(phrase)).toEqual({ hint });
    expect(isMusicIntent(phrase)).toBe(true);
    // Jamais une recherche du mot « musique ».
    expect(extractSpotifyPlayQuery(phrase)).toBeNull();
  });

  it.each([
    'Mets de la musique classique',
    'Mets du jazz',
    'Mets de la musique sur YouTube',
    'Lance la vidéo sur le PC',
    'Mets le PC en veille',
  ])('« %s » : pas une musique sans morceau', (phrase) => {
    expect(genericMusicRequest(phrase)).toBeNull();
  });

  it('un morceau nommé reste une recherche', () => {
    expect(extractSpotifyPlayQuery('Mets du jazz')).toBe('jazz');
    expect(extractSpotifyPlayQuery('Mets de la musique classique')).toBe('musique classique');
  });
});
