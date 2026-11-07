/**
 * Cible d'appareil Spotify pour une lecture ponctuelle (voix), sans changer le
 * schéma de l'outil `spotify_play` : l'agent dépose l'indice avant l'exécution.
 */

export type SpotifyPlayDeviceHint =
  { kind: 'speaker' } | { kind: 'pc' } | { kind: 'named'; name: string };

let pendingPlayDeviceHint: SpotifyPlayDeviceHint | null = null;

export function stashSpotifyPlayDeviceHint(hint: SpotifyPlayDeviceHint | null): void {
  pendingPlayDeviceHint = hint;
}

export function peekSpotifyPlayDeviceHint(): SpotifyPlayDeviceHint | null {
  return pendingPlayDeviceHint;
}

export function takeSpotifyPlayDeviceHint(): SpotifyPlayDeviceHint | null {
  const hint = pendingPlayDeviceHint;
  pendingPlayDeviceHint = null;
  return hint;
}

/** Oublie l'indice : il ne doit jamais servir à un autre tour. */
export function clearSpotifyPlayDeviceHint(): void {
  pendingPlayDeviceHint = null;
}

/** Suffixe « sur l'enceinte / le PC / la Devialet » en fin de requête de lecture. */
const APOST = "['\u2019]";

const PLAY_DEVICE_SUFFIX = new RegExp(
  String.raw`\s+sur\s+(?:l${APOST}?(?:enceinte|haut[\s-]?parleur(?:s)?)|(?:le\s+|l${APOST})?(?:pc|ordinateur(?:\s+portable|\s+de\s+bureau)?)|(?:la|le|l${APOST})\s+[\p{L}\p{N}][\p{L}\p{N}\-' ]{0,48})\s*[.!?]?\s*$`,
  'iu',
);

const DEVICE_IN_PHRASE = new RegExp(
  String.raw`\b(?:sur|vers)\s+(?:l${APOST}?(?:enceinte|haut[\s-]?parleur(?:s)?)|(?:le\s+|l${APOST})?(?:pc|ordinateur(?:\s+de\s+bureau)?)|(?:la|le|l${APOST})\s+[\p{L}\p{N}][\p{L}\p{N}\-' ]{0,48})`,
  'iu',
);

const TRANSFER_PRONOUN =
  /^(?:jarvis[,:]?\s*)?(?:mets|met|mettre|passe|passer|transf[èe]re(?:r)?)\s*[-]?\s*(?:la|le|ça|cela)\s*(?:-|–)?\s*/iu;

const TRANSFER_EXPLICIT =
  /^(?:jarvis[,:]?\s*)?(?:passe|passer|transf[èe]re(?:r)?|transfert|remets|remettre)\s+(?:la\s+)?(?:musique|lecture)\b/iu;

export function stripSpotifyPlayDeviceSuffix(query: string): string {
  return query.replace(PLAY_DEVICE_SUFFIX, '').trim();
}

export function extractSpotifyPlayDeviceHintFromQuery(query: string): SpotifyPlayDeviceHint | null {
  const match = query.match(PLAY_DEVICE_SUFFIX);
  if (!match) return null;
  return deviceHintFromSurClause(match[0]);
}

export function extractSpotifyPlayDeviceHint(prompt: string): SpotifyPlayDeviceHint | null {
  const trimmed = prompt.trim();
  const suffix = trimmed.match(PLAY_DEVICE_SUFFIX);
  if (suffix) return deviceHintFromSurClause(suffix[0]);
  const inline = trimmed.match(DEVICE_IN_PHRASE);
  if (
    inline &&
    (LAUNCH_FOR_DEVICE.test(trimmed) ||
      TRANSFER_EXPLICIT.test(trimmed) ||
      TRANSFER_PRONOUN.test(trimmed))
  ) {
    return deviceHintFromSurClause(inline[0]);
  }
  return null;
}

const LAUNCH_FOR_DEVICE =
  /^(?:jarvis[,:]?\s*)?(?:mets|met|mettre|lance|lancer|joue|jouer|écoute|écouter|ecoute|ecouter)\b/iu;

function deviceHintFromSurClause(clause: string): SpotifyPlayDeviceHint | null {
  const text = clause.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (/enceinte|haut[\s-]?parleur/.test(text)) return { kind: 'speaker' };
  if (/\b(?:le\s+)?(?:pc|ordinateur)\b/.test(text)) return { kind: 'pc' };
  const named = clause
    .match(new RegExp(String.raw`\s(?:la|le|l${APOST})\s+(.+?)\s*$`, 'iu'))?.[1]
    ?.trim();
  if (named && !/enceinte|ordinateur|^pc$/i.test(named)) return { kind: 'named', name: named };
  const bare = clause
    .match(
      new RegExp(
        String.raw`\bsur\s+(?!l${APOST}?enceinte|le\s+pc|l${APOST}ordinateur)([\p{L}\p{N}][\p{L}\p{N}\-' ]{1,48})\s*$`,
        'iu',
      ),
    )?.[1]
    ?.trim();
  if (bare) return { kind: 'named', name: bare };
  return null;
}

export type SpotifyTransferTarget = SpotifyPlayDeviceHint;

export function extractSpotifyTransferTarget(prompt: string): SpotifyTransferTarget | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (!isSpotifyTransferPhrase(trimmed)) return null;
  const hint = extractSpotifyPlayDeviceHint(trimmed);
  return hint;
}

export function isSpotifyTransferPhrase(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!DEVICE_IN_PHRASE.test(trimmed)) return false;
  if (TRANSFER_PRONOUN.test(trimmed)) return true;
  if (TRANSFER_EXPLICIT.test(trimmed)) return true;
  return false;
}
