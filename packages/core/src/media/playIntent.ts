/**
 * Intention « lancer un morceau » : partagée par le provider de démonstration
 * et par l'agent (tous fournisseurs). Sans ça, un modèle (Ollama y compris)
 * invente « je n'ai pas trouvé cet artiste » sans jamais appeler Spotify.
 *
 * Jarvis n'est pas un assistant uniquement musical : on ne force un outil
 * Spotify que si le **dernier** message utilisateur est clairement de la
 * musique. Un « X de Y » du type « la capitale de la France » n'en est pas.
 */

import { isCurrentTrackQuestion } from './currentTrackIntent.js';

const OPEN_SPOTIFY_ONLY =
  /^(?:jarvis[,:]?\s*)?(?:ouvre|ouvrir|lance|lancer|démarre|demarrer)\s+spotify\s*[.!]?\s*$/iu;

/** Verbes d'écoute, pas « lance Chrome ». */
const LISTEN_PREFIX =
  /^(?:jarvis[,:]?\s*)?(?:(?:est-ce que tu peux|peux-tu|pourrais-tu|je (?:veux|voudrais|aimerais)|j['’]aimerais)\s+)?(?:écouter|ecouter|écoute|ecoute|jouer|joue)\s+(?:moi\s+)?(?:un peu\s+(?:de\s+)?)?/iu;

const LAUNCH_TRACK_PREFIX =
  /^(?:jarvis[,:]?\s*)?(?:lancer|lance|mettre|mets)\s+(?:moi\s+)?/iu;

const NOT_A_TRACK =
  /\b(syst[eè]me|machine|fichier|dossier|fen[eê]tre|processus|application|chrome|firefox|edge|notepad|calculatrice|word|excel|vscode|code|ordinateur|pc|ram|cpu|erreur|bourse|cours|action|navigateur|terminal|powershell|r[ée]glages?|m[ée]t[ée]o|heure|date|e-?mails?|courrier|google|wikipedia|recherche|internet|personnalisation|m[ée]moire)\b/iu;

const MUSIC_CONTROL =
  /\b(spotify|musique|morceau|chanson|playlist|shuffle|al[ée]atoire)\b/iu;

/** Fautes phonétiques observées (voix / frappe), appliquées en plus de la requête brute. */
const SPELLING_ALIASES: Array<[RegExp, string]> = [
  [/\bnecfeu\b/gi, 'nekfeu'],
  [/\bun versat\b/gi, 'on verra'],
  [/\bversat\b/gi, 'on verra'],
];

/**
 * Dernier message = demande musicale (lecture ou contrôle). Sinon l'agent
 * garde le catalogue d'outils général, sans spotify_*.
 */
export function isMusicIntent(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  if (OPEN_SPOTIFY_ONLY.test(trimmed)) return false;
  if (isCurrentTrackQuestion(trimmed)) return true;
  if (extractSpotifyPlayQuery(trimmed)) return true;

  const normalized = trimmed.toLowerCase();
  if (/qu(?:'|e )est-ce qui joue|morceau (?:actuel|en cours)/.test(normalized)) return true;
  if (/morceau suivant|piste suivante|chanson suivante/.test(normalized)) return true;
  if (/morceau pr[ée]c[ée]dent|piste pr[ée]c[ée]dente|chanson pr[ée]c[ée]dente/.test(normalized)) {
    return true;
  }
  if (/\bshuffle\b|mode al[ée]atoire/.test(normalized)) return true;
  if (/\bvolume\b/.test(normalized)) return true;
  if (/^(?:jarvis[,:]?\s*)?pause\b/iu.test(trimmed) && !NOT_A_TRACK.test(trimmed)) return true;
  if (MUSIC_CONTROL.test(normalized) && /\b(pause|reprend|reprendre|arr[êe]te)\b/.test(normalized)) {
    return true;
  }
  if (/^(?:jarvis[,:]?\s*)?(?:reprend(?:s|re)?(?:\s+la\s+musique)?|mets la musique)\s*[.!]?\s*$/iu.test(trimmed)) {
    return true;
  }
  if (/\bsur spotify\b/.test(normalized)) return true;
  return false;
}

/**
 * Extrait la requête à passer à `spotify_play`, ou `null` si ce n'est pas
 * une demande de lecture (ex. « Lance Spotify » = ouvrir l'appli,
 * « lance Chrome » = autre application, « pause » = contrôle,
 * « qu'est-ce qui joue sur Spotify ? » = morceau en cours).
 */
export function extractSpotifyPlayQuery(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (OPEN_SPOTIFY_ONLY.test(trimmed)) return null;
  if (isCurrentTrackQuestion(trimmed)) return null;
  if (isPlaybackControlOnly(trimmed)) return null;

  const normalized = trimmed.toLowerCase();

  if (/^(?:jarvis[,:]?\s*)?mets la musique\s*[.!]?\s*$/iu.test(trimmed)) {
    return null;
  }

  if (/\bsur spotify\b/.test(normalized)) {
    const withoutSuffix = trimmed.replace(/\s*sur spotify\s*[.!]?\s*$/iu, '');
    const afterVerb = withoutSuffix.replace(LISTEN_PREFIX, '').replace(LAUNCH_TRACK_PREFIX, '').trim();
    const query = (afterVerb || withoutSuffix).replace(/[.!?]+$/u, '').trim();
    if (query && !/^spotify$/i.test(query) && !NOT_A_TRACK.test(query)) return query;
  }

  const metsDu = trimmed.match(
    /^(?:jarvis[,:]?\s*)?mets\s+(?:du|de la|de l['’])\s+(.+?)\s*[.!]?\s*$/iu,
  );
  if (metsDu?.[1] && !NOT_A_TRACK.test(metsDu[1])) return metsDu[1].trim();

  if (LISTEN_PREFIX.test(trimmed)) {
    const rest = trimmed
      .replace(LISTEN_PREFIX, '')
      .replace(/[.!?]+$/u, '')
      .trim();
    if (rest && !/^spotify$/i.test(rest) && !NOT_A_TRACK.test(rest)) return rest;
  }

  if (LAUNCH_TRACK_PREFIX.test(trimmed)) {
    const rest = trimmed
      .replace(LAUNCH_TRACK_PREFIX, '')
      .replace(/[.!?]+$/u, '')
      .trim();
    if (rest && looksLikeTrackQuery(rest)) return rest;
  }

  if (looksLikeBareTrackDeArtist(trimmed)) return trimmed.replace(/[.!?]+$/u, '').trim();

  return null;
}

function isPlaybackControlOnly(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  if (/\bvolume\b/.test(normalized)) return true;
  if (/^(?:jarvis[,:]?\s*)?(?:pause|reprend(?:s|re)?)\b/iu.test(prompt)) return true;
  if (/morceau suivant|morceau pr[ée]c[ée]dent|mode al[ée]atoire|\bshuffle\b/.test(normalized)) {
    return true;
  }
  return false;
}

function looksLikeTrackQuery(rest: string): boolean {
  if (!rest || /^spotify$/i.test(rest)) return false;
  if (NOT_A_TRACK.test(rest)) return false;
  if (looksLikeBareTrackDeArtist(rest)) return true;
  if (MUSIC_CONTROL.test(rest)) return true;
  return false;
}

function looksLikeBareTrackDeArtist(prompt: string): boolean {
  if (/[?]/.test(prompt)) return false;
  if (NOT_A_TRACK.test(prompt)) return false;
  if (/^(?:le|la|les|l['’]|un|une|des|du|de la|cette?|mon|ma|mes|ton|ta|tes|quel(?:le)?s?)\b/iu.test(prompt)) {
    return false;
  }
  // eslint-disable-next-line no-useless-escape -- motif Spotify validé sur le PC : laissé tel quel.
  return /^(?:\p{Lu}[\p{L}\p{N} «»"'’:,.\-]{1,79})\s+de\s+(?:\p{Lu}[\p{L}\p{N} «»"'’\-]{1,39})$/u.test(
    prompt,
  );
}

/** Variantes envoyées à l'API Search, requête d'origine en premier (pas d'orthographe imposée). */
export function searchQueryVariants(query: string): string[] {
  const stripped = query
    .replace(
      /^(?:jarvis[,:]?\s*)?(?:je (?:veux|voudrais|aimerais)|j['’]aimerais|écoute[rz]?|écouter|ecouter|lance[rz]?|joue[rz]?|mets|mettre)\s+/iu,
      '',
    )
    .replace(/[.!?]+$/u, '')
    .trim();

  const aliased = applyAliases(query);
  const strippedAliased = applyAliases(stripped);
  const withoutDe = strippedAliased.replace(/\s+de\s+/gi, ' ').trim();

  return uniqueNonEmpty([query.trim(), stripped, aliased, strippedAliased, withoutDe]);
}

function applyAliases(text: string): string {
  return SPELLING_ALIASES.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(key);
  }
  return result;
}
