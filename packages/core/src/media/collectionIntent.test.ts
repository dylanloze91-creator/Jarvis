import { describe, expect, it } from 'vitest';
import { extractSpotifyCollectionRequest } from './collectionIntent.js';
import { extractSpotifyPlayQuery, isMusicIntent } from './playIntent.js';

// Phrases écrites pour l'essai (24 novembre 2026), jamais celles de l'utilisateur.
describe('playlists et albums Spotify', () => {
  it('lit une playlist', () => {
    expect(extractSpotifyCollectionRequest('Mets la playlist Chill du dimanche')).toMatchObject({
      kind: 'playlist',
      query: 'Chill du dimanche',
      mine: false,
    });
    expect(extractSpotifyCollectionRequest('Jarvis, lance ma playlist Sport')).toMatchObject({
      kind: 'playlist',
      query: 'Sport',
      mine: true,
    });
    for (const text of ['Tu peux me mettre la playlist Lofi pour travailler sur Spotify ?', 'Peux-tu mettre la playlist Lofi pour travailler sur Spotify ?']) {
      expect(extractSpotifyCollectionRequest(text), text).toMatchObject({ kind: 'playlist', query: 'Lofi pour travailler' });
    }
    expect(extractSpotifyCollectionRequest('Joue la playlist Été 2024 sur la Devialet')).toMatchObject({
      kind: 'playlist',
      query: 'Été 2024',
      withDevice: 'Été 2024 sur la Devialet',
    });
  });

  it('lit un album, avec son artiste', () => {
    expect(extractSpotifyCollectionRequest('Mets l’album Discovery de Daft Punk')).toMatchObject({
      kind: 'album',
      query: 'Discovery de Daft Punk',
      mine: false,
    });
    expect(extractSpotifyCollectionRequest('Joue l\'album Random Access Memories, s’il te plaît')).toMatchObject({
      kind: 'album',
      query: 'Random Access Memories',
    });
  });

  it('laisse les morceaux et le reste tels quels', () => {
    for (const text of ['Mets Get Lucky de Daft Punk', 'Crée une playlist avec mes morceaux préférés', 'C’est quoi cet album ?', 'Mets la playlist']) {
      expect(extractSpotifyCollectionRequest(text), text).toBeNull();
    }
    expect(extractSpotifyPlayQuery('Mets Get Lucky de Daft Punk')).toBe('Get Lucky de Daft Punk');
  });

  it('une demande de playlist est de la musique, jamais un morceau nommé « la playlist … »', () => {
    expect(isMusicIntent('Mets la playlist Chill du dimanche')).toBe(true);
    expect(extractSpotifyPlayQuery('Mets la playlist Chill du dimanche')).toBeNull();
    expect(extractSpotifyPlayQuery('Mets l’album Discovery de Daft Punk')).toBeNull();
  });
});
