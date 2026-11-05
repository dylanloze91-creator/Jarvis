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
export function isMusicIntent(prompt: string, options: SpotifyTargetOptions = {}): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  if (OPEN_SPOTIFY_ONLY.test(trimmed)) return false;
  if (isCurrentTrackQuestion(trimmed)) return true;
  // 5.0.69 : « passe la musique sur l'enceinte », « mets X sur le PC ».
  if (extractSpotifyTransferTarget(trimmed, options)) return true;
  if (extractSpotifyPlayQuery(trimmed, options)) return true;

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
export function extractSpotifyPlayQuery(
  prompt: string,
  options: SpotifyTargetOptions = {},
): string | null {
  // 5.0.69 : « mets Daft Punk sur l'enceinte » → requête « Daft Punk », la fin « sur … »
  // choisit l'appareil (voir `extractSpotifyPlayTarget`).
  const targeted = extractSpotifyPlayTarget(prompt, options);
  if (targeted) return targeted.query;
  return basePlayQuery(prompt);
}

function basePlayQuery(prompt: string): string | null {
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

/* ------------------------------------------------------------------ */
/* 5.0.69 : appareil choisi à la voix                                  */
/* ------------------------------------------------------------------ */

/**
 * Appareil demandé pour cette lecture : « l'enceinte » (celle des réglages, sinon la seule
 * enceinte Connect visible), « le PC » (application de bureau), ou un appareil Connect nommé.
 */
export type SpotifyPlayTarget =
  | { kind: 'speaker' }
  | { kind: 'pc' }
  | { kind: 'named'; name: string };

export interface SpotifyTargetOptions {
  /**
   * Noms d'appareils Spotify Connect connus (enceinte des réglages, dernière liste vue).
   * Sans eux, seuls « l'enceinte » et « le PC » sont reconnus : un « sur … » inconnu
   * reste dans le titre (« Sur la route de Memphis »).
   */
  knownDeviceNames?: readonly string[];
}

const TARGET_ARTICLE = /^(?:le|la|les|l['’]|mon|ma|mes|ce|cet|cette)\s*/iu;
const SPEAKER_WORDS = /^(?:enceintes?|haut[- ]parleurs?|baffles?)(?:\s+(?:connect|spotify|bluetooth))?$/iu;
const PC_WORDS =
  /^(?:pc|ordi|ordinateur(?:\s+de\s+bureau)?|bureau|appli(?:cation)?(?:\s+spotify)?(?:\s+de\s+bureau)?|spotify\s+(?:du|de\s+ce|sur\s+le)\s+pc)$/iu;
/** « mets la musique sur pause » n'est pas un appareil. */
const NOT_A_DEVICE =
  /^(?:pause|play|lecture|r[ée]p[ée]tition|repeat|al[ée]atoire|shuffle|muet|mute|fort|doucement|spotify|youtube|deezer)$/iu;
/** Dernier « sur … » de la phrase : ce qui précède est la demande de lecture. */
const TARGET_SUFFIX = /^(.*\S)\s+sur\s+(\S.*?)\s*[.!?]*$/iu;
const TRANSFER_FORM =
  /^(?:jarvis[,:]?\s*)?(?<verb>passe|passer|mets|mettre|remets|remettre|bascule|basculer|transf[èe]re|transf[ée]rer|envoie|envoyer)(?<pronoun>[- ](?:la|le|moi))?(?:\s+(?<object>la\s+musique|la\s+lecture|le\s+son|le\s+morceau|la\s+chanson|la\s+playlist|ça|ca|spotify))?\s+sur\s+(?<where>\S.*?)\s*[.!?]*$/iu;

export function normalizeSpotifyDeviceName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function classifyTarget(
  rawName: string,
  knownDeviceNames: readonly string[],
  allowUnknown: boolean,
): SpotifyPlayTarget | null {
  const name = rawName.replace(TARGET_ARTICLE, '').replace(/[.!?]+$/u, '').trim();
  if (!name) return null;
  if (SPEAKER_WORDS.test(name)) return { kind: 'speaker' };
  if (PC_WORDS.test(name)) return { kind: 'pc' };
  if (NOT_A_DEVICE.test(name)) return null;
  const wanted = normalizeSpotifyDeviceName(name);
  if (!wanted) return null;
  const known = knownDeviceNames.map((entry) => entry.trim()).filter(Boolean);
  const match = known.find((entry) => {
    const candidate = normalizeSpotifyDeviceName(entry);
    return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
  });
  if (match) return { kind: 'named', name: match };
  return allowUnknown ? { kind: 'named', name } : null;
}

/**
 * « passe la musique sur l'enceinte », « mets-la sur le PC », « transfère sur la Devialet » :
 * la lecture en cours change d'appareil (outil `spotify_transfer`). Un appareil inconnu est
 * renvoyé tel quel : l'outil dira qu'il ne le trouve pas.
 */
export function extractSpotifyTransferTarget(
  prompt: string,
  options: SpotifyTargetOptions = {},
): SpotifyPlayTarget | null {
  const match = TRANSFER_FORM.exec(prompt.trim());
  if (!match?.groups) return null;
  const { verb, pronoun, object, where } = match.groups;
  const explicit =
    Boolean(pronoun || object) || /^(?:bascul|transf)/iu.test(verb ?? '');
  if (!explicit) return null;
  return classifyTarget(where ?? '', options.knownDeviceNames ?? [], true);
}

/**
 * « mets Daft Punk sur l'enceinte » → `{ query: 'Daft Punk', target: { kind: 'speaker' } }`.
 * La fin « sur … » n'est retirée que si elle désigne l'enceinte, le PC ou un appareil connu ;
 * sinon elle reste dans le titre (« Sur la route de Memphis »).
 */
export function extractSpotifyPlayTarget(
  prompt: string,
  options: SpotifyTargetOptions = {},
): { query: string; target: SpotifyPlayTarget } | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (OPEN_SPOTIFY_ONLY.test(trimmed)) return null;
  if (isCurrentTrackQuestion(trimmed)) return null;
  if (extractSpotifyTransferTarget(trimmed, options)) return null;
  const match = TARGET_SUFFIX.exec(trimmed);
  if (!match) return null;
  const target = classifyTarget(match[2] ?? '', options.knownDeviceNames ?? [], false);
  if (!target) return null;
  const query = playQueryBefore(match[1] ?? '');
  if (!query) return null;
  return { query, target };
}

/** Requête de lecture dans la partie qui précède « sur <appareil> ». */
function playQueryBefore(head: string): string | null {
  const trimmed = head.trim();
  if (!trimmed) return null;
  const direct = basePlayQuery(trimmed);
  if (direct) return direct;
  if (isPlaybackControlOnly(trimmed)) return null;
  const rest = trimmed
    .replace(/^(?:jarvis[,:]?\s*)?(?:mets|lance|joue|écoute|ecoute)[- ]moi\s+/iu, '')
    .replace(LISTEN_PREFIX, '')
    .replace(LAUNCH_TRACK_PREFIX, '')
    .replace(/[.!?]+$/u, '')
    .trim();
  // Sans verbe d'écoute (« Daft Punk sur l'enceinte »), ce n'est pas une demande.
  if (!rest || rest === trimmed) return null;
  if (/^spotify$/i.test(rest) || NOT_A_TRACK.test(rest)) return null;
  if (/^(?:la|le)\s+(?:musique|son|morceau)$/iu.test(rest)) return null;
  return rest;
}

/** Forme texte passée aux outils : « enceinte », « pc » ou le nom de l'appareil. */
export function spotifyTargetToText(target: SpotifyPlayTarget): string {
  if (target.kind === 'speaker') return 'enceinte';
  if (target.kind === 'pc') return 'pc';
  return target.name;
}

export function spotifyTargetFromText(text: string): SpotifyPlayTarget {
  const name = text.trim();
  const normalized = normalizeSpotifyDeviceName(name.replace(TARGET_ARTICLE, ''));
  if (SPEAKER_WORDS.test(normalized) || normalized === 'enceinte') return { kind: 'speaker' };
  if (PC_WORDS.test(normalized) || normalized === 'pc') return { kind: 'pc' };
  return { kind: 'named', name };
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
