import { describe, expect, it } from 'vitest';
import { speakerReflexPhrase } from './reflex.js';

describe('phrases réflexes de l’enceinte', () => {
  it('raccourcit les commandes Spotify déjà reconnues', () => {
    expect(speakerReflexPhrase('spotify_play', 'mets Daft Punk')).toBe('C’est parti.');
    expect(speakerReflexPhrase('spotify_pause', 'pause')).toBe('En pause.');
    expect(speakerReflexPhrase('spotify_next', 'morceau suivant')).toBe('Morceau suivant.');
    expect(speakerReflexPhrase('spotify_previous', 'morceau précédent')).toBe('Morceau précédent.');
    expect(speakerReflexPhrase('spotify_resume', 'reprends')).toBe('C’est reparti.');
    expect(speakerReflexPhrase('spotify_set_volume', 'mets le volume à 40')).toBe('Volume à 40.');
    expect(speakerReflexPhrase('spotify_set_volume', 'baisse le volume')).toBe('Volume réglé.');
    expect(speakerReflexPhrase('spotify_set_shuffle', 'mode aléatoire')).toBe('Lecture aléatoire.');
    expect(speakerReflexPhrase('spotify_set_shuffle', 'arrête le mode aléatoire')).toBe('Lecture dans l’ordre.');
    expect(speakerReflexPhrase('spotify_transfer', 'sur la Devialet')).toBe('C’est parti.');
  });

  it('ne raccourcit pas une question sur le morceau en cours', () => {
    expect(speakerReflexPhrase('spotify_current_track', 'qu’est-ce qui joue')).toBeNull();
    expect(speakerReflexPhrase('generer_image', 'dessine un chat')).toBeNull();
  });
});
