import { parseYoutubeVideoId } from './url.js';

export const NO_CAPTIONS_ERROR =
  "Cette vidéo n'a pas de sous-titres, donc je ne peux pas encore la résumer.";

const INVALID_URL_ERROR =
  "Ce lien n'est pas une adresse YouTube reconnue (watch, youtu.be, Shorts ou live).";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_CAPTION_TRACKS = 4;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

interface InnertubeClient {
  clientName: string;
  clientVersion: string;
  userAgent: string;
}

const INNERTUBE_CLIENTS: InnertubeClient[] = [
  {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  },
  {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
  },
];

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** Piste générée automatiquement (`kind: asr`). */
  automatic: boolean;
}

export interface YoutubeTranscriptData {
  videoId: string;
  title?: string;
  language?: string;
  automatic?: boolean;
}

export interface YoutubeTranscriptResult {
  ok: boolean;
  content: string;
  data?: YoutubeTranscriptData;
}

interface LoadedPlayer {
  player: unknown;
}

/**
 * Pistes dans l'ordre demandé : français (manuel, puis automatique), puis
 * les sous-titres automatiques de la vidéo, puis n'importe quelle piste.
 */
export function orderCaptionTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  const french = (track: CaptionTrack): boolean => /^fr(?:-|$)/i.test(track.languageCode);
  const rank = (track: CaptionTrack): number => {
    if (french(track) && !track.automatic) return 0;
    if (french(track)) return 1;
    if (track.automatic) return 2;
    return 3;
  };
  return [...tracks].sort((left, right) => rank(left) - rank(right));
}

export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  return orderCaptionTracks(tracks)[0] ?? null;
}

export function captionTracksFromPlayer(player: unknown): CaptionTrack[] {
  const tracks = readPath(player, [
    'captions',
    'playerCaptionsTracklistRenderer',
    'captionTracks',
  ]);
  if (!Array.isArray(tracks)) return [];

  const parsed: CaptionTrack[] = [];
  for (const track of tracks) {
    if (!track || typeof track !== 'object') continue;
    const record = track as Record<string, unknown>;
    const baseUrl = stringField(record, 'baseUrl') || stringField(record, 'url');
    if (!baseUrl) continue;
    const languageCode = stringField(record, 'languageCode') || stringField(record, 'language');
    parsed.push({
      baseUrl,
      languageCode,
      automatic: record.kind === 'asr',
    });
  }
  return parsed;
}

export function titleFromPlayer(player: unknown): string | undefined {
  const title = readPath(player, ['videoDetails', 'title']);
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

/** Extrait `ytInitialPlayerResponse` du HTML de la page watch, s'il est présent. */
export function playerResponseFromWatchHtml(html: string): unknown | null {
  const key = 'ytInitialPlayerResponse';
  let from = 0;
  while (from < html.length) {
    const index = html.indexOf(key, from);
    if (index < 0) return null;
    const relative = html.slice(index, index + key.length + 80).indexOf('{');
    if (relative >= 0) {
      const json = sliceJsonObject(html, index + relative);
      if (json) {
        try {
          return JSON.parse(json) as unknown;
        } catch {
          // Essai sur l'occurrence suivante.
        }
      }
    }
    from = index + key.length;
  }
  return null;
}

/** Texte brut d'une piste timedtext (JSON3 ou XML srv1 / srv3). */
export function parseCaptionPayload(body: string): string {
  const trimmed = body.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const fromJson = parseJson3(trimmed);
    if (fromJson) return fromJson;
  }
  if (trimmed.includes('<')) return parseCaptionXml(trimmed);
  return '';
}

export function formatTranscriptContent(input: {
  title?: string;
  languageCode: string;
  automatic: boolean;
  text: string;
}): string {
  const language = input.languageCode || 'inconnue';
  const languageLine = input.automatic ? `${language} (sous-titres automatiques)` : language;
  return [
    ...(input.title ? [`Titre : ${input.title}`] : []),
    `Langue des sous-titres : ${languageLine}`,
    '',
    'Transcription :',
    input.text,
  ].join('\n');
}

/**
 * Sous-titres publics, sans clé API et sans télécharger le fichier vidéo.
 * `fetchImpl` est injectable pour les tests.
 */
export async function fetchYoutubeTranscript(
  rawUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<YoutubeTranscriptResult> {
  const videoId = parseYoutubeVideoId(rawUrl);
  if (!videoId) return { ok: false, content: INVALID_URL_ERROR };

  let title: string | undefined;
  let sawPlayer = false;
  let captionFailed = false;
  let failure: unknown = null;

  const loaders = [
    ...INNERTUBE_CLIENTS.map((client) => () => loadInnertubePlayer(videoId, client, fetchImpl)),
    () => loadWatchPlayer(videoId, fetchImpl),
  ];

  for (const load of loaders) {
    let loaded: LoadedPlayer | null = null;
    try {
      loaded = await load();
    } catch (error) {
      failure = error;
      continue;
    }
    if (!loaded) continue;
    sawPlayer = true;
    title = titleFromPlayer(loaded.player) ?? title;

    const tracks = orderCaptionTracks(captionTracksFromPlayer(loaded.player)).slice(
      0,
      MAX_CAPTION_TRACKS,
    );
    if (tracks.length === 0) continue;

    for (const track of tracks) {
      try {
        const text = (await readCaptionText(track, fetchImpl)).replace(/\s+/g, ' ').trim();
        if (!text) continue;
        return {
          ok: true,
          content: formatTranscriptContent({
            ...(title ? { title } : {}),
            languageCode: track.languageCode,
            automatic: track.automatic,
            text,
          }),
          data: {
            videoId,
            ...(title ? { title } : {}),
            language: track.languageCode,
            automatic: track.automatic,
          },
        };
      } catch (error) {
        captionFailed = true;
        failure = error;
      }
    }
  }

  if (!sawPlayer) {
    const detail = failure ? describeError(failure) : 'réponse vide';
    return {
      ok: false,
      content: `Impossible de lire les sous-titres de cette vidéo : ${detail}`,
      data: { videoId },
    };
  }

  if (captionFailed && !title) {
    return {
      ok: false,
      content: `Impossible de récupérer les sous-titres de cette vidéo : ${describeError(failure)}`,
      data: { videoId },
    };
  }

  return {
    ok: false,
    content: NO_CAPTIONS_ERROR,
    data: { videoId, ...(title ? { title } : {}) },
  };
}

/** Premier lecteur Innertube ou page watch qui répond. Sert à l'audio et aux sous-titres. */
export async function loadYoutubePlayer(
  videoId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<unknown | null> {
  // Un lecteur refusé (LOGIN_REQUIRED, anti-robot) n'arrête pas la recherche :
  // un autre client ou la page watch peut encore répondre. Il n'est rendu
  // qu'en dernier, pour que l'appelant puisse dire pourquoi YouTube a refusé.
  let refused: unknown | null = null;
  for (const client of INNERTUBE_CLIENTS) {
    try {
      const loaded = await loadInnertubePlayer(videoId, client, fetchImpl);
      if (!loaded?.player) continue;
      if (!youtubeRefusalReason(loaded.player)) return loaded.player;
      refused ??= loaded.player;
    } catch {
      // Client suivant : un échec réseau ne doit pas empêcher le repli.
    }
  }
  try {
    const loaded = await loadWatchPlayer(videoId, fetchImpl);
    if (loaded?.player && !youtubeRefusalReason(loaded.player)) {
      if (titleFromPlayer(loaded.player) || captionTracksFromPlayer(loaded.player).length > 0) {
        return loaded.player;
      }
    }
    if (loaded?.player && youtubeRefusalReason(loaded.player)) refused ??= loaded.player;
  } catch {
    return refused;
  }
  return refused;
}

/**
 * Motif du refus de YouTube (`playabilityStatus` différent de `OK`), ou
 * `null` si la vidéo est lisible. Exemple réel : « Connectez-vous pour
 * confirmer que vous n'êtes pas un robot ».
 */
export function youtubeRefusalReason(player: unknown): string | null {
  const status = readPath(player, ['playabilityStatus', 'status']);
  if (typeof status !== 'string' || status === 'OK') return null;
  const reason = readPath(player, ['playabilityStatus', 'reason']);
  return typeof reason === 'string' && reason.trim() ? reason.trim() : status;
}

/** Texte intégral de la meilleure piste (français, puis automatique, puis n'importe laquelle). */
export async function readBestCaption(
  player: unknown,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ text: string; languageCode: string; automatic: boolean } | null> {
  const tracks = orderCaptionTracks(captionTracksFromPlayer(player)).slice(0, MAX_CAPTION_TRACKS);
  for (const track of tracks) {
    try {
      const text = (await readCaptionText(track, fetchImpl)).replace(/\s+/g, ' ').trim();
      if (text) return { text, languageCode: track.languageCode, automatic: track.automatic };
    } catch {
      // Piste suivante.
    }
  }
  return null;
}

async function loadInnertubePlayer(
  videoId: string,
  client: InnertubeClient,
  fetchImpl: typeof fetch,
): Promise<LoadedPlayer | null> {
  const payload = await requestText(
    PLAYER_ENDPOINT,
    fetchImpl,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': client.userAgent,
      },
      body: JSON.stringify({
        context: {
          client: {
            hl: 'fr',
            gl: 'FR',
            clientName: client.clientName,
            clientVersion: client.clientVersion,
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    },
  );
  if (!payload) return null;
  try {
    return { player: JSON.parse(payload) as unknown };
  } catch {
    return null;
  }
}

async function loadWatchPlayer(
  videoId: string,
  fetchImpl: typeof fetch,
): Promise<LoadedPlayer | null> {
  const html = await requestText(
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=fr`,
    fetchImpl,
    {
      headers: {
        'user-agent': BROWSER_UA,
        cookie: 'CONSENT=YES+cb',
      },
    },
  );
  if (!html) return null;
  const player = playerResponseFromWatchHtml(html);
  return player ? { player } : { player: {} };
}

async function readCaptionText(track: CaptionTrack, fetchImpl: typeof fetch): Promise<string> {
  const base = assertCaptionUrl(track.baseUrl);
  const jsonBody = await requestText(withParam(base, 'fmt', 'json3'), fetchImpl, {
    headers: { 'user-agent': BROWSER_UA },
  });
  const fromJson = jsonBody ? parseCaptionPayload(jsonBody) : '';
  if (fromJson) return fromJson;

  const xmlBody = await requestText(withParam(base, 'fmt', 'srv1'), fetchImpl, {
    headers: { 'user-agent': BROWSER_UA },
  });
  const fromXml = xmlBody ? parseCaptionPayload(xmlBody) : '';
  if (fromXml) return fromXml;
  return '';
}

/**
 * Uniquement l'API timedtext de YouTube. Refuse les URL de flux média
 * (`videoplayback`, googlevideo, etc.) pour ne jamais télécharger la vidéo.
 */
function assertCaptionUrl(raw: string): string {
  const url = new URL(raw, 'https://www.youtube.com');
  const host = url.hostname.toLowerCase();
  const youtubeHost = host === 'youtube.com' || host.endsWith('.youtube.com');
  if (url.protocol !== 'https:' || !youtubeHost || !url.pathname.includes('/api/timedtext')) {
    throw new Error('adresse de sous-titres inattendue');
  }
  return url.toString();
}

function withParam(raw: string, key: string, value: string): string {
  const url = new URL(raw);
  url.searchParams.set(key, value);
  return url.toString();
}

async function requestText(
  url: string,
  fetchImpl: typeof fetch,
  init: RequestInit = {},
): Promise<string | null> {
  const headers = new Headers(init.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', BROWSER_UA);
  if (!headers.has('accept-language')) headers.set('accept-language', 'fr-FR,fr;q=0.9,en;q=0.5');

  const response = await fetchImpl(url, {
    ...init,
    headers,
    redirect: 'follow',
    signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  const type = response.headers.get('content-type') ?? '';
  if (/^(video|audio)\//i.test(type)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('le serveur a renvoyé un fichier média, pas des sous-titres');
  }
  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > 2_000_000) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('réponse trop volumineuse pour des sous-titres');
  }
  if (!response.ok) return null;
  return response.text();
}

function parseJson3(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return '';
  }
  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events)) return '';

  const parts: string[] = [];
  for (const event of events) {
    const segs = (event as { segs?: unknown }).segs;
    if (!Array.isArray(segs)) continue;
    const piece = segs
      .map((seg) => {
        const utf8 = (seg as { utf8?: unknown }).utf8;
        return typeof utf8 === 'string' ? utf8 : '';
      })
      .join('');
    const cleaned = piece.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) parts.push(cleaned);
  }
  return parts.join(' ');
}

function parseCaptionXml(xml: string): string {
  const textNodes = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)].map((match) =>
    cleanCaptionFragment(match[1] ?? ''),
  );
  const fromText = textNodes.filter(Boolean);
  if (fromText.length > 0) return fromText.join(' ');

  const paragraphs = [...xml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) =>
    cleanCaptionFragment((match[1] ?? '').replace(/<[^>]+>/g, '')),
  );
  return paragraphs.filter(Boolean).join(' ');
}

function cleanCaptionFragment(value: string): string {
  return decodeCaptionEntities(value).replace(/\s+/g, ' ').trim();
}

function decodeCaptionEntities(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => codePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => codePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function codePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function sliceJsonObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
