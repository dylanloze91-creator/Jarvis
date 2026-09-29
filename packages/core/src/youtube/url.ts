/**
 * Liens YouTube publics acceptés par `youtube_transcript` : watch, youtu.be,
 * Shorts et live. Partagé par l'agent (forcer l'outil sur le dernier message)
 * et par l'outil lui-même.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const WATCH_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);

/** Identifiant vidéo à 11 caractères, ou `null` si le lien n'est pas une vidéo YouTube. */
export function parseYoutubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }

  if (!WATCH_HOSTS.has(host)) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const head = parts[0] ?? '';
  if (head === 'watch') {
    const id = url.searchParams.get('v') ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }
  if ((head === 'shorts' || head === 'live') && parts[1] && VIDEO_ID.test(parts[1])) {
    return parts[1];
  }
  return null;
}

/**
 * Premier lien YouTube du texte, sans la ponctuation finale collée par la
 * phrase (« …/vidéo. »). `null` s'il n'y en a pas.
 */
export function extractYoutubeUrl(text: string): string | null {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const candidate = (match[0] ?? '').replace(/[.,;:!?)]+$/g, '').replace(/[»]+$/g, '');
    if (parseYoutubeVideoId(candidate)) return candidate;
  }
  return null;
}
