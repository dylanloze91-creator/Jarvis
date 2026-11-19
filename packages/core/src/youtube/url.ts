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
export const INVALID_YOUTUBE_URL_MESSAGE =
  "Ce lien n'est pas une adresse YouTube reconnue (watch, youtu.be, Shorts ou live).";

/**
 * Phrase d'échec pour un lien sans vidéo. Une adresse YouTube dont l'identifiant n'en est pas un
 * (« watch?v=your_video_id », vue deux fois dans le journal d'audit : le modèle avait inventé le
 * lien) dit au modèle de demander le lien à l'utilisateur au lieu d'en inventer un autre.
 */
export function youtubeUrlProblem(raw: string): string {
  let host = '';
  try {
    host = new URL(raw.trim()).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return INVALID_YOUTUBE_URL_MESSAGE;
  }
  if (host !== 'youtu.be' && !WATCH_HOSTS.has(host)) return INVALID_YOUTUBE_URL_MESSAGE;
  return "Ce lien YouTube ne désigne aucune vidéo : son identifiant n'est pas valable (un identifiant fait 11 caractères). N'invente jamais un lien : demande à l'utilisateur de coller l'adresse de la vidéo.";
}

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
