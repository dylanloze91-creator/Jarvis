import { describe, expect, it } from 'vitest';
import { EXPRESS_RULES, expressRuleMatches, expressToolRule } from './agent/expressRules.js';
import { ORCHESTRA_TEAMS } from './agent/orchestraTeams.js';
import {
  extractSpotifyPlayQuery,
  isMusicIntent,
  isSpotifyPausePhrase,
  isSpotifyResumePhrase,
} from './media/playIntent.js';

/**
 * Essais de la Live 5.0.80 avec l'utilisateur, 23 novembre 2026. Phrases écrites pour l'essai,
 * jamais celles de l'utilisateur.
 */
const infosPc = EXPRESS_RULES.find((rule) => rule.id === 'infos-pc')!;
const allTeams = new Set(ORCHESTRA_TEAMS);

describe('infos du PC : « ou » n’est pas « où »', () => {
  it('une phrase avec « ou » appelle l’outil sans modèle', () => {
    for (const text of [
      'Montre-moi un aperçu ou les informations sur mon PC',
      'Les infos du PC ou l’état de la machine',
      'jarvis donne moi une info ou les informations sur mon ordinateur',
    ]) {
      expect(expressRuleMatches(infosPc, text), text).toBe(true);
      expect(expressToolRule(EXPRESS_RULES, text, allTeams)?.id, text).toBe('infos-pc');
    }
  });

  it('une vraie question en « où » va toujours au modèle', () => {
    for (const text of [
      'Où est l’état de mon PC dans les réglages ?',
      'Où sont les informations système de Windows ?',
      'Par où passer pour voir les informations sur mon PC ?',
    ]) {
      expect(expressRuleMatches(infosPc, text), text).toBe(false);
    }
  });
});

describe('Spotify : « mets pause » met en pause, jamais un morceau nommé « pause »', () => {
  it('les tournures de pause, et ce que Whisper en fait', () => {
    for (const text of [
      'Mets pause sur Spotify',
      'Met en pause sur Spotify.',
      'Pause sur Spotify',
      'Mes pauses sur Spotify',
      'Mes pause',
      'Jarvis, mets pause la musique',
      'Arrête la musique sur Spotify s’il te plaît',
    ]) {
      expect(isSpotifyPausePhrase(text), text).toBe(true);
      expect(extractSpotifyPlayQuery(text), text).toBeNull();
      expect(isMusicIntent(text), text).toBe(true);
    }
  });

  it('« mets play » reprend la lecture, même écrit « mes play » par Whisper', () => {
    for (const text of [
      'Mets play sur Spotify',
      'Mes play sur Spotify.',
      'Remets play',
      'Play',
      'Jarvis, mets en lecture sur Spotify',
      'Reprends la musique sur Spotify s’il te plaît',
    ]) {
      expect(isSpotifyResumePhrase(text), text).toBe(true);
      expect(isSpotifyPausePhrase(text), text).toBe(false);
      expect(extractSpotifyPlayQuery(text), text).toBeNull();
      expect(isMusicIntent(text), text).toBe(true);
    }
    expect(isSpotifyResumePhrase('Mets Play Hard de David Guetta sur Spotify')).toBe(false);
    expect(extractSpotifyPlayQuery('Mets Play Hard de David Guetta sur Spotify')).toBe(
      'Play Hard de David Guetta',
    );
  });

  it('un titre qui contient le mot reste un titre', () => {
    expect(isSpotifyPausePhrase('Mets Pause Café de Juliette sur Spotify')).toBe(false);
    expect(extractSpotifyPlayQuery('Mets Pause Café de Juliette sur Spotify')).toBe('Pause Café de Juliette');
    expect(isSpotifyPausePhrase('Mets la pause déjeuner dans mon agenda')).toBe(false);
  });
});
