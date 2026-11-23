/**
 * Phrases courtes dites par l'enceinte quand le tour est déjà résolu
 * (outil Spotify forcé, sans inventer de nouvelle règle). Le détail
 * (titre, appareil) reste le texte écrit sur le PC.
 */

import { isSpotifyDeviceQuestion } from '../media/spotifyDeviceVoice.js';

const SHUFFLE_OFF = /d[ée]sactiv|desactiv|coupe|arr[êe]te/iu;

/**
 * `toolResult` : le texte rendu par l'outil. Une question d'appareil (« Sur la Devialet ou sur
 * le PC ? », 5.0.69) n'a rien lancé : aucune phrase réflexe, la question doit être dite.
 */
export function speakerReflexPhrase(toolName: string, userText: string, toolResult?: string): string | null {
  if (toolResult !== undefined && isSpotifyDeviceQuestion(toolResult)) return null;
  switch (toolName) {
    case 'spotify_play':
    case 'spotify_transfer':
      return 'C’est parti.';
    case 'spotify_pause':
      return 'En pause.';
    case 'spotify_resume':
      return 'C’est reparti.';
    case 'spotify_next':
      return 'Morceau suivant.';
    case 'spotify_previous':
      return 'Morceau précédent.';
    case 'spotify_set_shuffle':
      return SHUFFLE_OFF.test(userText) ? 'Lecture dans l’ordre.' : 'Lecture aléatoire.';
    case 'spotify_set_volume':
    case 'spotify_volume_step': {
      // 24 novembre 2026 : le volume dit est celui que Spotify a vraiment appliqué (plafond de
      // l'enceinte compris), pas le chiffre demandé.
      const applied = toolResult ? /(\d{1,3}) %/.exec(toolResult) : null;
      if (applied) {
        const value = Math.min(100, Number(applied[1]));
        return /plafond/.test(toolResult ?? '') ? `Volume à ${value}, c’est le maximum pour l’enceinte.` : `Volume à ${value}.`;
      }
      if (toolResult && /d[ée]j[àa] [àa] z[ée]ro/.test(toolResult)) return 'Le volume est déjà à zéro.';
      if (toolName === 'spotify_volume_step') return 'Volume réglé.';
      const match = /(\d{1,3})/.exec(userText);
      if (!match) return 'Volume réglé.';
      const value = Math.min(100, Number(match[1]));
      return `Volume à ${value}.`;
    }
    default:
      return null;
  }
}
