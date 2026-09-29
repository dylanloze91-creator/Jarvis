export interface SiteBlockToolPlan {
  tool: string;
  args: Record<string, unknown>;
}

const SITE_ALIASES: Record<string, string> = {
  instagram: 'instagram.com',
  insta: 'instagram.com',
  tiktok: 'tiktok.com',
  youtube: 'youtube.com',
  yt: 'youtube.com',
  facebook: 'facebook.com',
  fb: 'facebook.com',
  twitter: 'x.com',
  reddit: 'reddit.com',
  netflix: 'netflix.com',
  twitch: 'twitch.tv',
  linkedin: 'linkedin.com',
  whatsapp: 'whatsapp.com',
  snapchat: 'snapchat.com',
  discord: 'discord.com',
};

const DEFAULT_FOCUS_MINUTES = 60;

/**
 * Route une phrase vers un outil `siteblock_*`. `null` si ce n’est pas
 * une demande de blocage — pour ne pas voler « Lance Chrome » ni Spotify.
 */
export function extractSiteBlockIntent(prompt: string): SiteBlockToolPlan | null {
  const text = prompt.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();

  if (isStatusRequest(normalized)) {
    return { tool: 'siteblock_get_status', args: {} };
  }

  if (isStopFocusRequest(normalized)) {
    return { tool: 'siteblock_stop_focus', args: {} };
  }

  const period = extractPeriodRequest(text, normalized);
  if (period) return period;

  if (isRemovePeriodRequest(normalized)) {
    return null;
  }

  const focus = extractFocusRequest(text, normalized);
  if (focus) return focus;

  const unblock = extractUnblockRequest(text, normalized);
  if (unblock) return unblock;

  const block = extractBlockRequest(text, normalized);
  if (block) return block;

  const toggle = extractBlockingToggle(normalized);
  if (toggle) return toggle;

  return null;
}

function isStatusRequest(normalized: string): boolean {
  return (
    /quels?\s+sites?\s+(?:sont|est)\s+bloqu/i.test(normalized) ||
    /sites?\s+bloqu[ée]s?/i.test(normalized) ||
    /[ée]tat\s+(?:du\s+)?blocage/i.test(normalized) ||
    /blocage\s+(?:est\s+)?(?:actif|activ[ée]|en\s+cours)/i.test(normalized)
  );
}

function isStopFocusRequest(normalized: string): boolean {
  return (
    /(?:arr[êe]te|stoppe|coupe|d[ée]sactive)\s+(?:le\s+|mon\s+|la\s+)?(?:mode\s+)?(?:travail|concentration|focus)/i.test(
      normalized,
    ) || /(?:arr[êe]te|stoppe)\s+(?:le\s+)?focus/i.test(normalized)
  );
}

function isRemovePeriodRequest(normalized: string): boolean {
  return /(?:supprime|retire|enl[ève]ve)\s+(?:la\s+)?p[ée]riode/i.test(normalized);
}

function extractFocusRequest(text: string, normalized: string): SiteBlockToolPlan | null {
  const isFocus =
    /(?:active|d[ée]marre|lance)\s+(?:le\s+|mon\s+|ma\s+)?mode\s+(?:travail|concentration|focus)/i.test(
      normalized,
    ) ||
    /mode\s+(?:travail|concentration|focus)\s+pendant/i.test(normalized) ||
    /session\s+de\s+concentration/i.test(normalized);

  const duration = extractDurationMinutes(normalized);
  const domain = extractDomain(text, [
    'bloque',
    'bloquer',
    'blocage de',
    'blocage du',
  ]);

  if (isFocus) {
    return {
      tool: 'siteblock_start_focus',
      args: {
        minutes: duration ?? DEFAULT_FOCUS_MINUTES,
        ...(domain ? { domains: [domain] } : {}),
      },
    };
  }

  if (domain && duration !== null) {
    return {
      tool: 'siteblock_start_focus',
      args: { minutes: duration, domains: [domain] },
    };
  }

  return null;
}

function extractBlockRequest(text: string, normalized: string): SiteBlockToolPlan | null {
  if (!/\bbloque(?:r|s)?\b|\bbloquons\b/.test(normalized)) return null;
  if (/(?:d[ée]bloque|d[ée]bloquer)/.test(normalized)) return null;
  const domain = extractDomain(text, ['bloque', 'bloquer', 'bloques', 'bloquons']);
  if (!domain) return null;
  return { tool: 'siteblock_add_domain', args: { domain } };
}

function extractUnblockRequest(text: string, normalized: string): SiteBlockToolPlan | null {
  if (
    !/(?:d[ée]bloque(?:r|s)?|autorise(?:r)?\s+[àa]\s+nouveau|autorise(?:r)?\s+de\s+nouveau)/.test(
      normalized,
    )
  ) {
    return null;
  }
  const domain = extractDomain(text, [
    'débloque',
    'debloque',
    'débloquer',
    'debloquer',
    'autorise',
    'autoriser',
  ]);
  if (!domain) return null;
  return { tool: 'siteblock_remove_domain', args: { domain } };
}

function extractBlockingToggle(normalized: string): SiteBlockToolPlan | null {
  if (
    /(?:d[ée]sactive|coupe|arr[êe]te)\s+(?:le\s+)?blocage/.test(normalized) ||
    /d[ée]sactive\s+(?:tous\s+)?les\s+blocages/.test(normalized)
  ) {
    return { tool: 'siteblock_set_blocking', args: { enabled: false } };
  }
  if (/(?:active|allume|remet)\s+(?:le\s+)?blocage/.test(normalized)) {
    return { tool: 'siteblock_set_blocking', args: { enabled: true } };
  }
  return null;
}

function extractPeriodRequest(text: string, normalized: string): SiteBlockToolPlan | null {
  if (
    !/(?:programme|planifie|cr[ée]e)\s+(?:le\s+|un\s+)?blocage/.test(normalized) &&
    !/p[ée]riode\s+de\s+blocage/.test(normalized)
  ) {
    return null;
  }

  const times = extractClockRange(text);
  if (!times) return null;
  return {
    tool: 'siteblock_add_period',
    args: { start: times.start, end: times.end, name: 'Jarvis' },
  };
}

function extractDurationMinutes(normalized: string): number | null {
  const hours = normalized.match(/(\d+)\s*(?:h|heures?)\b/);
  if (hours?.[1]) {
    const value = Number(hours[1]);
    if (Number.isFinite(value) && value > 0) return clampMinutes(value * 60);
  }

  const minutes = normalized.match(/(\d+)\s*(?:min(?:ute)?s?)\b/);
  if (minutes?.[1]) {
    const value = Number(minutes[1]);
    if (Number.isFinite(value) && value > 0) return clampMinutes(value);
  }

  if (/\bune\s+heure\b/.test(normalized)) return 60;
  if (/\bune\s+demi[- ]?heure\b/.test(normalized)) return 30;

  return null;
}

function clampMinutes(value: number): number {
  return Math.min(1440, Math.max(1, Math.round(value)));
}

function extractClockRange(text: string): { start: string; end: string } | null {
  const match = text.match(
    /(?:de\s+)?(\d{1,2})\s*(?:h(?:eures?)?|:)\s*(\d{2})?\s*(?:à|a|-|–|—)\s*(\d{1,2})\s*(?:h(?:eures?)?|:)\s*(\d{2})?/i,
  );
  if (!match) return null;
  const start = formatClock(match[1], match[2]);
  const end = formatClock(match[3], match[4]);
  if (!start || !end) return null;
  return { start, end };
}

function formatClock(hoursRaw: string | undefined, minutesRaw: string | undefined): string | null {
  if (!hoursRaw) return null;
  const hours = Number(hoursRaw);
  const minutes = minutesRaw ? Number(minutesRaw) : 0;
  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function extractDomain(text: string, keywords: string[]): string | null {
  const quoted = text.match(/[«"']([^»"']{1,200})[»"']/);
  if (quoted?.[1]) return normalizeDomain(quoted[1]);

  const fromUrl = text.match(/https?:\/\/[^\s)\]>,]+/i);
  if (fromUrl?.[0]) return normalizeDomain(fromUrl[0]);

  const escaped = keywords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const after = text.match(
    new RegExp(`(?:${escaped})\\s+(?:à\\s+nouveau\\s+|de\\s+nouveau\\s+)?([\\p{L}\\p{N}._-]{1,80})`, 'iu'),
  );
  if (after?.[1]) return normalizeDomain(after[1]);

  return null;
}

export function normalizeSiteBlockDomain(raw: string): string {
  return normalizeDomain(raw);
}

function normalizeDomain(raw: string): string {
  const trimmed = raw.trim().replace(/[.,;:!?]+$/u, '');
  if (!trimmed) return trimmed;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, '');
    if (hostname.includes('.')) return hostname;
    return SITE_ALIASES[hostname] ?? hostname;
  } catch {
    const token = trimmed.toLowerCase().replace(/^www\./, '');
    return SITE_ALIASES[token] ?? token;
  }
}
