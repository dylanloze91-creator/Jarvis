import { describe, expect, it } from 'vitest';
import { extractSpotifyPlayQuery, isMusicIntent, searchQueryVariants } from './playIntent.js';

describe('extractSpotifyPlayQuery', () => {
  it('extrait « écouter On Verra de Nekfeu » (orthographe exacte du repro)', () => {
    expect(extractSpotifyPlayQuery('écouter On Verra de Nekfeu')).toBe('On Verra de Nekfeu');
    expect(extractSpotifyPlayQuery('écouter On verra de Necfeu')).toBe('On verra de Necfeu');
  });

  it('extrait « je veux écouter un versat de Necfeu »', () => {
    expect(extractSpotifyPlayQuery('je veux écouter un versat de Necfeu')).toBe(
      'un versat de Necfeu',
    );
  });

  it('extrait un titre nu « On Verra de Nekfeu »', () => {
    expect(extractSpotifyPlayQuery('On Verra de Nekfeu')).toBe('On Verra de Nekfeu');
  });

  it('extrait « lance Get Lucky de Daft Punk » sans exiger « sur Spotify »', () => {
    expect(extractSpotifyPlayQuery('lance Get Lucky de Daft Punk')).toBe('Get Lucky de Daft Punk');
  });

  it('extrait « mets du Jul »', () => {
    expect(extractSpotifyPlayQuery('mets du Jul')).toBe('Jul');
  });

  it('extrait « mets Daft Punk » et « mets autre chose » sans appareil', () => {
    expect(extractSpotifyPlayQuery('mets Daft Punk')).toBe('Daft Punk');
    expect(extractSpotifyPlayQuery('mets autre chose')).toBe('autre chose');
  });

  it('laisse « Lance Spotify » à open_application', () => {
    expect(extractSpotifyPlayQuery('Lance Spotify')).toBeNull();
    expect(extractSpotifyPlayQuery('ouvre Spotify')).toBeNull();
  });

  it('ne prend pas « mets la musique » (reprise, pas une recherche)', () => {
    expect(extractSpotifyPlayQuery('mets la musique')).toBeNull();
  });

  it('ne force pas Spotify sur un titre ambigu du type « la capitale de la France »', () => {
    expect(extractSpotifyPlayQuery('la capitale de la France')).toBeNull();
    expect(isMusicIntent('la capitale de la France')).toBe(false);
  });

  it('ne lance jamais Spotify sur une demande d’image (enceinte, 10 novembre : « Générement une image de Inata Tenauto » → spotify_play)', () => {
    for (const text of [
      'Générement une image de Inata Tenauto',
      'Génère une image de Hinata de Naruto',
      'Génère-moi une image de Hinata dans Naruto',
      'Fais-moi un sticker de Renard',
      'Une Photo de Paris',
      'Dessine Hinata de Naruto',
    ]) {
      expect(extractSpotifyPlayQuery(text), text).toBeNull();
      expect(isMusicIntent(text), text).toBe(false);
    }
    // Un vrai titre nu reste un morceau.
    expect(extractSpotifyPlayQuery('Get Lucky de Daft Punk')).toBe('Get Lucky de Daft Punk');
  });

  it('ne prend pas « lance Chrome » pour une lecture', () => {
    expect(extractSpotifyPlayQuery('lance Chrome')).toBeNull();
    expect(isMusicIntent('lance Chrome')).toBe(false);
  });

  it('reconnaît pause / volume / suivant comme de la musique, pas une recherche', () => {
    expect(extractSpotifyPlayQuery('pause')).toBeNull();
    expect(isMusicIntent('pause')).toBe(true);
    expect(isMusicIntent('Stop la musique.')).toBe(true);
    expect(isMusicIntent('coupe la musique')).toBe(true);
    expect(isMusicIntent('éteins Spotify')).toBe(true);
    expect(isMusicIntent('stop')).toBe(false);
    expect(extractSpotifyPlayQuery('Mets le volume Spotify à 50 %')).toBeNull();
    expect(isMusicIntent('Mets le volume Spotify à 50 %')).toBe(true);
    expect(isMusicIntent('quelle heure est-il ?')).toBe(false);
  });

  it('« que joue Spotify » est de la musique, mais pas une recherche à lancer', () => {
    for (const prompt of [
      'Que joue Spotify en ce moment ?',
      "Qu'est-ce qui joue sur Spotify ?",
      "C'est quoi cette musique sur Spotify ?",
      "Écoute, c'est quoi ce son ?",
      "C'est qui qui chante ?",
    ]) {
      expect(isMusicIntent(prompt)).toBe(true);
      expect(extractSpotifyPlayQuery(prompt)).toBeNull();
    }
  });

  it('garde « joue du Nekfeu » et « lance lomepal sur spotify » pour spotify_play', () => {
    expect(extractSpotifyPlayQuery('joue du Nekfeu')).toBe('du Nekfeu');
    expect(extractSpotifyPlayQuery('lance lomepal sur spotify')).toBe('lomepal');
  });

  it('retire enceinte et PC, et garde un nom d’appareil dans la requête', () => {
    expect(extractSpotifyPlayQuery('mets Daft Punk sur l’enceinte')).toBe('Daft Punk');
    expect(extractSpotifyPlayQuery('mets Daft Punk sur le PC')).toBe('Daft Punk');
    expect(extractSpotifyPlayQuery('mets Daft Punk sur l’ordinateur')).toBe('Daft Punk');
    expect(extractSpotifyPlayQuery('lance Get Lucky sur la Devialet')).toBe(
      'Get Lucky sur la Devialet',
    );
    expect(extractSpotifyPlayQuery('mets Il pleut sur la ville')).toBe('Il pleut sur la ville');
  });

  it('garde un titre entier « Sur la route de Memphis »', () => {
    expect(extractSpotifyPlayQuery('Sur la route de Memphis')).toBe('Sur la route de Memphis');
    expect(extractSpotifyPlayQuery('mets Sur la route de Memphis sur l’enceinte')).toBe(
      'Sur la route de Memphis',
    );
  });

  it('ne confond pas transfert et lecture', () => {
    expect(extractSpotifyPlayQuery('passe la musique sur l’enceinte')).toBeNull();
    expect(isMusicIntent('passe la musique sur l’enceinte')).toBe(true);
  });

  it('une question générale sur la musique n’expose pas Spotify', () => {
    expect(isMusicIntent('Qui chante Bohemian Rhapsody ?')).toBe(false);
    expect(isMusicIntent('Quel est le dernier album de Nekfeu ?')).toBe(false);
  });
});

describe('searchQueryVariants', () => {
  it('garde la requête d’origine en premier', () => {
    expect(searchQueryVariants('On Verra de Nekfeu')[0]).toBe('On Verra de Nekfeu');
  });

  it('ajoute Necfeu → Nekfeu et versat → On Verra', () => {
    const variants = searchQueryVariants('un versat de Necfeu').map((value) => value.toLowerCase());
    expect(variants.some((value) => value.includes('nekfeu'))).toBe(true);
    expect(variants.some((value) => value.includes('on verra'))).toBe(true);
  });
});
