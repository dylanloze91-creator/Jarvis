/**
 * Volume Spotify dit à la voix, sans modèle (24 novembre 2026).
 *
 * Constat des essais du 23 novembre : « monte le volume de l'enceinte » partait au modèle, qui
 * répondait qu'il ne pouvait pas, alors que `spotify_set_volume` existe. Comme pause et reprise,
 * une phrase de volume claire part directement vers l'outil. Le plafond de l'enceinte (70 par
 * défaut, `spotifySpeakerMaxVolume`) reste appliqué par le fournisseur Spotify, jamais ici.
 */

export type SpotifyVolumeCommand =
  | { kind: 'set'; percent: number }
  | { kind: 'step'; direction: 'up' | 'down' };

/** Pas d'un « plus fort » / « moins fort ». */
export const VOLUME_STEP = 10;

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  dix: 10,
  quinze: 15,
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
  'soixante dix': 70,
  'quatre vingt': 80,
  'quatre vingts': 80,
  'quatre vingt dix': 90,
  cent: 100,
  max: 100,
  maximum: 100,
  fond: 100,
};

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/%/g, ' pourcent ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ce qui n'est pas le volume de Spotify : Windows, une vidéo, le micro. */
const OTHER_TARGET = /\b(pc|ordinateur|ordi|windows|video|youtube|micro|microphone|film|television|tele)\b/;

const LEAD = String.raw`(?:(?:jarvis|ok|bon|dis|eh|alors|stp|svp)\s+)*`;
const TAIL = String.raw`(?:\s+(?:s il te plait|stp|svp|merci|jarvis))*`;
/** Ce dont on règle le volume : musique, enceinte, Spotify (même déformé). */
const TARGET = String.raw`(?:\s+(?:de|du|sur|a|dans|pour)\s+(?:la\s+|l\s+|le\s+)?(?:musique|enceinte|devialet|phantom|fantome|s?pot+[iy]f(?:y|ie|i|aie|aille)?))?`;
const SOUND = String.raw`(?:le\s+|la\s+)?(?:volume|son|musique)`;
const AMOUNT = String.raw`(?:\s+(?:un\s+peu|un\s+petit\s+peu|encore|un\s+cran|d\s+un\s+cran))?`;

const UP = new RegExp(
  String.raw`^${LEAD}(?:(?:monte|montes|augmente|augmentes|pousse|remonte)${AMOUNT}\s+${SOUND}${AMOUNT}${TARGET}|(?:(?:mets|met|mes|parle|joue)\s+)?(?:un\s+peu\s+|encore\s+)?plus\s+fort${TARGET})${TAIL}$`,
);
const DOWN = new RegExp(
  String.raw`^${LEAD}(?:(?:baisse|baisses|diminue|diminues|descends|redescends)${AMOUNT}\s+${SOUND}${AMOUNT}${TARGET}|(?:(?:mets|met|mes|parle|joue)\s+)?(?:un\s+peu\s+|encore\s+)?moins\s+fort${TARGET})${TAIL}$`,
);

const SET_VERB = String.raw`(?:(?:mets|met|mes|regle|regles|monte|baisse|passe|remets|fixe|descends)\s+)?`;
const SET = new RegExp(
  String.raw`^${LEAD}${SET_VERB}${SOUND}${TARGET}\s+(?:a|sur|au)\s+(.+?)(?:\s+pourcent|\s+pour\s+cent)?${TARGET}${TAIL}$`,
);

function readAmount(raw: string): number | null {
  const text = raw.trim().replace(/^(?:le\s+)/, '');
  if (/^\d{1,3}$/.test(text)) {
    const value = Number(text);
    return value <= 100 ? value : null;
  }
  return NUMBER_WORDS[text] ?? null;
}

/**
 * Lit une phrase de volume. `null` si ce n'est pas clairement le volume de la musique :
 * le tour suit alors son chemin habituel (modèle compris).
 */
export function parseSpotifyVolumeCommand(prompt: string): SpotifyVolumeCommand | null {
  const text = fold(prompt);
  if (!text || text.length > 90) return null;
  if (OTHER_TARGET.test(text)) return null;
  const set = SET.exec(text);
  if (set) {
    const percent = readAmount(set[1] ?? '');
    return percent === null ? null : { kind: 'set', percent };
  }
  if (UP.test(text)) return { kind: 'step', direction: 'up' };
  if (DOWN.test(text)) return { kind: 'step', direction: 'down' };
  return null;
}

/** Volume visé après un pas, borné à 0–100 (le plafond de l'enceinte est appliqué ensuite). */
export function steppedVolume(current: number, direction: 'up' | 'down', step = VOLUME_STEP): number {
  const next = direction === 'up' ? current + step : current - step;
  return Math.max(0, Math.min(100, Math.round(next)));
}
