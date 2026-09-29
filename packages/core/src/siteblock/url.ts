/** URL locale par défaut de l’API ControlApi de SiteBlock (loopback uniquement). */
export const DEFAULT_SITEBLOCK_BASE_URL = 'http://127.0.0.1:18741';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export type SiteBlockUrlCheck =
  | { ok: true; origin: string }
  | { ok: false; reason: string };

/**
 * L’API SiteBlock n’est joignable que sur la machine : HTTP(S) vers
 * 127.0.0.1 / localhost / ::1. Tout le reste (LAN, Internet, autre
 * protocole) est refusé — pas d’accès illimité.
 */
export function checkSiteBlockBaseUrl(raw: string): SiteBlockUrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'URL SiteBlock manquante.' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'URL SiteBlock invalide.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Protocole SiteBlock non autorisé : ${url.protocol}` };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!LOOPBACK_HOSTS.has(hostname)) {
    return {
      ok: false,
      reason:
        'L’URL SiteBlock doit rester en local (127.0.0.1, localhost ou ::1). Les adresses distantes sont refusées.',
    };
  }

  return { ok: true, origin: url.origin };
}

/** Heure quotidienne au format HH:mm (00:00–23:59). */
export const SITEBLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
