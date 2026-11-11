/**
 * Phrases courtes dites par l'enceinte quand le tour est déjà résolu
 * (outil Spotify forcé, sans inventer de nouvelle règle). Le détail
 * (titre, appareil) reste le texte écrit sur le PC.
 */

const SHUFFLE_OFF = /d[ée]sactiv|desactiv|coupe|arr[êe]te/iu;

export function speakerReflexPhrase(toolName: string, userText: string): string | null {
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
    case 'spotify_set_volume': {
      const match = /(\d{1,3})/.exec(userText);
      if (!match) return 'Volume réglé.';
      const value = Math.min(100, Number(match[1]));
      return `Volume à ${value}.`;
    }
    default:
      return null;
  }
}
