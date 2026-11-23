/**
 * Playlists et albums Spotify demandés à la voix ou au clavier (24 novembre 2026).
 *
 * Avant, « mets la playlist Chill » cherchait un morceau nommé « la playlist Chill ». La phrase
 * est lue par règles ; l'appareil éventuel (« sur la Devialet ») reste à part, comme pour un
 * morceau.
 */
import { extractSpotifyPlayDeviceHintFromQuery, stripSpotifyPlayDeviceSuffix } from './spotifyDeviceVoice.js';

export type SpotifyCollectionKind = 'playlist' | 'album';

export interface SpotifyCollectionRequest {
  kind: SpotifyCollectionKind;
  /** Ce qu'il faut chercher (nom de la playlist, ou album et artiste). */
  query: string;
  /** « ma playlist », « mes playlists » : chercher d'abord dans celles de l'utilisateur. */
  mine: boolean;
  /** Texte d'origine sans l'appareil, pour retrouver l'appareil demandé. */
  withDevice: string;
}

const VERB = String.raw`(?:mets|met|mes|mais|mettre|lance|lances|lancer|joue|joues|jouer|passe|passes|passer|ecoute|ecouter|remets|remettre|demarre|demarrer|ouvre|lis)`;
const LEAD = String.raw`^(?:(?:jarvis|ok|bon|dis|eh|alors|allez)\s*[,:]?\s+)*(?:(?:est\s+ce\s+que\s+)?(?:tu\s+peux|peux\s*-?\s*tu|tu\s+pourrais|pourrais\s*-?\s*tu)\s+)?(?:me\s+|moi\s+)?`;
const AFTER_VERB = String.raw`(?:\s+(?:moi|nous))?\s+`;
const ARTICLE = String.raw`(?:la|le|l|ma|mon|une|un|ta|ton|notre|cette)\s*`;

const COLLECTION = new RegExp(
  String.raw`${LEAD}${VERB}${AFTER_VERB}${ARTICLE}(playlist|playliste|play\s+list|liste\s+de\s+lecture|album)\s+(?:de\s+lecture\s+)?(.+)$`,
  'u',
);

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’]/g, "'")
    .replace(/'/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Retire la politesse et « sur Spotify » de la fin, en gardant la casse du nom. */
function cleanTail(text: string): string {
  return text
    .replace(/[.!?]+$/u, '')
    .replace(/\s*,?\s*(?:s['’]il te pla[iî]t|s il te pla[iî]t|stp|svp|merci)$/iu, '')
    .replace(/\s+(?:sur|dans|de)\s+s?pot+[iy]f(?:y|ie|i|aie|aille)?$/iu, '')
    .replace(/^["«“]\s*|\s*["»”]$/gu, '')
    .trim();
}

/**
 * Lit « mets la playlist X », « lance ma playlist X », « joue l'album X de Y ».
 * `null` pour tout le reste : le chemin des morceaux ne change pas.
 */
export function extractSpotifyCollectionRequest(prompt: string): SpotifyCollectionRequest | null {
  const original = prompt.trim();
  if (!original || original.length > 160) return null;
  const folded = normalize(original).toLowerCase();
  const match = COLLECTION.exec(folded);
  if (!match) return null;
  const kindWord = match[1] ?? '';
  const kind: SpotifyCollectionKind = kindWord === 'album' ? 'album' : 'playlist';
  // Le nom est repris dans le texte d'origine (casse et accents), à la même position finale.
  const nameLength = (match[2] ?? '').length;
  const originalFlat = original.replace(/\s+/g, ' ');
  const tail = originalFlat.slice(Math.max(0, originalFlat.length - nameLength));
  const withDevice = cleanTail(tail);
  const hint = extractSpotifyPlayDeviceHintFromQuery(withDevice);
  const query = cleanTail(hint ? stripSpotifyPlayDeviceSuffix(withDevice) : withDevice);
  if (!query || query.length < 2) return null;
  const mine = /\b(?:ma|mon|mes|notre)\s*$/.test(folded.slice(0, folded.length - (match[2] ?? '').length - kindWord.length - 1).trim());
  return { kind, query, mine, withDevice };
}
