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

/** Une question « où jouer ? » reste valable 60 secondes, puis ce n'est plus un choix d'appareil. */
export const SPOTIFY_DEVICE_ASK_MS = 60_000;

export const SPOTIFY_DEVICE_FALLBACK_REPLY =
  "Je n'ai pas compris. Je le mets sur l'appareil des réglages.";

export interface SpotifyDeviceAsk {
  sessionId: string;
  query: string;
  askedAt: number;
  retried: boolean;
  /** Noms cités dans la question (enceintes, trois au plus). */
  speakerNames: string[];
  /** Noms d'appareils visibles acceptés comme réponse, plus l'enceinte du réglage. */
  deviceNames: string[];
}

const deviceAsks = new Map<string, SpotifyDeviceAsk>();
let suppressDeviceAsk = false;

export function rememberSpotifyDeviceAsk(ask: SpotifyDeviceAsk): void {
  deviceAsks.set(ask.sessionId, ask);
}

export function peekSpotifyDeviceAsk(sessionId: string, nowMs: number): SpotifyDeviceAsk | null {
  const ask = deviceAsks.get(sessionId);
  if (!ask) return null;
  if (nowMs - ask.askedAt > SPOTIFY_DEVICE_ASK_MS) {
    deviceAsks.delete(sessionId);
    return null;
  }
  return ask;
}

export function noteSpotifyDeviceAskRetried(sessionId: string): void {
  const ask = deviceAsks.get(sessionId);
  if (ask) ask.retried = true;
}

export function clearSpotifyDeviceAsk(sessionId: string): void {
  deviceAsks.delete(sessionId);
}

export function clearSpotifyDeviceAsks(): void {
  deviceAsks.clear();
  suppressDeviceAsk = false;
}

/** La réponse « peu importe » joue sur l'appareil du réglage : ne pas reposer la question. */
export function suppressNextSpotifyDeviceAsk(): void {
  suppressDeviceAsk = true;
}

export function consumeSpotifyDeviceAskSuppressed(): boolean {
  const suppressed = suppressDeviceAsk;
  suppressDeviceAsk = false;
  return suppressed;
}

export function clearSpotifyDeviceAskSuppression(): void {
  suppressDeviceAsk = false;
}

const HALT_PHRASE =
  /^(?:jarvis[,:]?\s*)?(?:stop|pause|tais[-\s]?toi|arr[êe]te(?:r)?(?:\s+(?:la\s+)?(?:musique|lecture))?|coupe(?:\s+(?:la\s+)?(?:musique|lecture))?)\s*[.!]?\s*$/iu;

/** « stop » et « pause » ne sont jamais une réponse à la question d'appareil. */
export function isSpotifyHaltPhrase(prompt: string): boolean {
  return HALT_PHRASE.test(prompt.trim());
}

export type SpotifyDeviceAnswer =
  | { kind: 'speaker' }
  | { kind: 'pc' }
  | { kind: 'named'; name: string }
  | { kind: 'usual' }
  | { kind: 'fuzzy' }
  | { kind: 'unrelated' };

function foldDeviceWords(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clé « à l'oreille » d'un mot, pour comparer ce que Whisper écrit à un nom d'appareil :
 * « fantôme » et « Phantom » → « fantom », « dévialé » et « Devialet » → « devial ».
 * Accents retirés, ph → f, qu/ck → k, y → i, lettres doublées réduites, lettres finales
 * muettes (e, s, t) retirées. Les chiffres (« 98 dB ») ne comptent pas.
 */
function soundKey(word: string): string {
  return word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/qu|ck/g, 'k')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1')
    .replace(/[est]+$/, '');
}

function soundKeys(text: string): string[] {
  return foldDeviceWords(text)
    .split(' ')
    .map(soundKey)
    .filter((key) => key.length >= 3);
}

/**
 * 5.0.77 : la réponse dictée ne reprend que le début du nom (« la Phantom » pour « Phantom 98 dB »)
 * et Whisper l'écrit comme il l'entend (« fantôme »). Un appareil est reconnu si les mots entendus
 * sonnent comme le début de son nom, et s'il est le seul dans ce cas.
 */
function deviceHeardAs(answer: string, deviceNames: readonly string[]): string | null {
  const heard = soundKeys(answer);
  if (heard.length === 0) return null;
  const matches = deviceNames.filter((name) => {
    const keys = soundKeys(name);
    return keys.length >= heard.length && heard.every((key, index) => keys[index] === key);
  });
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Réponse à « Devialet ou PC ? », sans « Jarvis ». Une phrase qui n'y répond
 * pas (autre demande, question) reste `unrelated` : la recherche attend encore.
 */
export function interpretSpotifyDeviceAnswer(
  prompt: string,
  deviceNames: readonly string[],
): SpotifyDeviceAnswer {
  const trimmed = prompt.trim().replace(/^(?:jarvis[,:]?\s*)/iu, '').trim();
  if (!trimmed || isSpotifyHaltPhrase(prompt)) return { kind: 'unrelated' };
  const body = foldDeviceWords(trimmed).replace(/^sur\s+/, '');
  if (body === 'peu importe' || body === 'comme dhabitude') return { kind: 'usual' };
  if (/^(?:lenceinte|enceinte|haut[\s-]?parleurs?|les haut[\s-]?parleurs?)$/.test(body)) {
    return { kind: 'speaker' };
  }
  if (/^(?:le pc|pc|lordi|lordinateur|ordinateur)$/.test(body)) return { kind: 'pc' };

  const bare = body.replace(/^(?:la|le|l)\s+/, '');
  for (const name of deviceNames) {
    const folded = foldDeviceWords(name);
    if (!folded || folded.length < 2) continue;
    if (bare === folded || body === folded) return { kind: 'named', name };
  }
  const heard = deviceHeardAs(bare, deviceNames);
  if (heard) return { kind: 'named', name: heard };

  const words = body.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 6) return { kind: 'unrelated' };
  if (/[?]/.test(trimmed)) return { kind: 'unrelated' };
  return { kind: 'fuzzy' };
}

function deviceArticle(name: string): string {
  const head = name.normalize('NFD').replace(/\p{M}/gu, '');
  return /^[aeiouyhœæ]/i.test(head) ? `l'${name}` : `la ${name}`;
}

/** Question dite telle quelle, sans passer par le modèle. */
export function spotifyDeviceQuestion(speakerNames: readonly string[], retry = false): string {
  const names = speakerNames.map((name) => name.trim()).filter(Boolean).slice(0, 3);
  if (names.length === 0) return retry ? 'PC ?' : 'Sur le PC ?';
  if (retry) {
    return names.length === 1 ? `${names[0]} ou PC ?` : `${names.join(', ')} ou PC ?`;
  }
  const cited = names.map(deviceArticle);
  if (cited.length === 1) return `Sur ${cited[0]} ou sur le PC ?`;
  const last = cited[cited.length - 1];
  const head = cited.slice(0, -1).join(', ');
  return `Sur ${head}, ${last} ou sur le PC ?`;
}

export function isSpotifyDeviceQuestion(text: string): boolean {
  const folded = text.trim();
  return /ou sur le PC\s*\?\s*$/iu.test(folded) || /ou PC\s*\?\s*$/iu.test(folded);
}

/**
 * Noms à citer : l'enceinte du réglage, ou la seule enceinte visible ;
 * plusieurs enceintes visibles : elles sont citées, trois au plus.
 */
export function connectSpeakerNamesForAsk(
  visibleSpeakerNames: readonly string[],
  configuredName: string | undefined,
  configuredIsComputer: boolean,
): string[] {
  const visible: string[] = [];
  for (const name of visibleSpeakerNames) {
    const trimmed = name.trim();
    if (!trimmed || visible.some((known) => foldDeviceWords(known) === foldDeviceWords(trimmed))) continue;
    visible.push(trimmed);
    if (visible.length === 3) break;
  }
  const configured = (configuredName ?? '').trim();
  if (configured && !configuredIsComputer) {
    if (visible.length > 1) return visible;
    return [configured];
  }
  return visible;
}
