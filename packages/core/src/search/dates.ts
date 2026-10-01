const FRENCH_MONTHS: Record<string, number> = {
  janvier: 0, janv: 0, jan: 0,
  fevrier: 1, févr: 1, fevr: 1, février: 1, fév: 1, fev: 1, feb: 1,
  mars: 2, mar: 2,
  avril: 3, avr: 3, apr: 3,
  mai: 4, may: 4,
  juin: 5, jun: 5,
  juillet: 6, juil: 6, jul: 6,
  août: 7, aout: 7, aug: 7,
  septembre: 8, sept: 8, sep: 8,
  octobre: 9, oct: 9,
  novembre: 10, nov: 10,
  décembre: 11, decembre: 11, déc: 11, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7,
  september: 8, october: 9, november: 10, december: 11,
};

const MONTH_NAME = String.raw`(janvier|janv\.?|f[ée]vrier|f[ée]vr?\.?|mars|avril|avr\.?|mai|juin|juillet|juil\.?|ao[uû]t|septembre|sept?\.?|octobre|oct\.?|novembre|nov\.?|d[ée]cembre|d[ée]c\.?|jan(?:uary)?\.?|feb(?:ruary)?\.?|mar(?:ch)?\.?|apr(?:il)?\.?|may|june?\.?|july?\.?|aug(?:ust)?\.?|september|october|november|december)`;

function monthIndex(raw: string): number | undefined {
  return FRENCH_MONTHS[raw.toLowerCase().replace(/\.$/, '')];
}

function utc(year: number, month: number, day: number): Date | undefined {
  const date = new Date(Date.UTC(year, month, day, 12));
  return Number.isFinite(date.getTime()) && date.getUTCDate() === day ? date : undefined;
}

/** Date RSS (RFC 822) ou ISO → ISO 8601, sinon `undefined`. */
export function parseFeedDate(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const time = Date.parse(value.trim());
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/**
 * Date en tête d'un extrait de moteur (« 30 sept. 2026 · … », « il y a
 * 3 jours — … », « Sep 30, 2026 … »). Rend la date ISO et l'extrait sans elle.
 */
export function leadingSnippetDate(
  snippet: string,
  now: Date = new Date(),
): { publishedAt?: string; rest: string } {
  const text = snippet.trim();
  const separators = String.raw`\s*(?:[·—–\-:|]|&middot;)\s*`;

  const relative = text.match(
    new RegExp(String.raw`^il y a\s+(\d{1,3})\s+(minutes?|min|heures?|h|jours?|j|semaines?|mois)${separators}`, 'iu'),
  );
  if (relative?.[1] && relative[2]) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms =
      unit.startsWith('min') ? amount * 60_000
        : unit.startsWith('h') ? amount * 3_600_000
          : unit.startsWith('j') ? amount * 86_400_000
            : unit.startsWith('sem') ? amount * 7 * 86_400_000
              : amount * 30 * 86_400_000;
    return { publishedAt: new Date(now.getTime() - ms).toISOString(), rest: text.slice(relative[0].length) };
  }

  const yesterday = text.match(new RegExp(String.raw`^hier${separators}`, 'iu'));
  if (yesterday) {
    return {
      publishedAt: new Date(now.getTime() - 86_400_000).toISOString(),
      rest: text.slice(yesterday[0].length),
    };
  }

  const french = text.match(
    new RegExp(String.raw`^(\d{1,2})(?:er)?\s+${MONTH_NAME}\s+(\d{4})${separators}`, 'iu'),
  );
  if (french?.[1] && french[2] && french[3]) {
    const month = monthIndex(french[2]);
    const date = month === undefined ? undefined : utc(Number(french[3]), month, Number(french[1]));
    if (date) return { publishedAt: date.toISOString(), rest: text.slice(french[0].length) };
  }

  const english = text.match(
    new RegExp(String.raw`^${MONTH_NAME}\s+(\d{1,2}),?\s+(\d{4})${separators}`, 'iu'),
  );
  if (english?.[1] && english[2] && english[3]) {
    const month = monthIndex(english[1]);
    const date = month === undefined ? undefined : utc(Number(english[3]), month, Number(english[2]));
    if (date) return { publishedAt: date.toISOString(), rest: text.slice(english[0].length) };
  }

  const iso = text.match(new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?${separators}`, 'u'));
  if (iso?.[1] && iso[2] && iso[3]) {
    const date = utc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (date) return { publishedAt: date.toISOString(), rest: text.slice(iso[0].length) };
  }

  return { rest: text };
}

export function ageInDays(iso: string | undefined, now: Date = new Date()): number | undefined {
  if (!iso) return undefined;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return undefined;
  return (now.getTime() - time) / 86_400_000;
}

/** « 30 sept. 2026 » ; l'heure s'ajoute pour une date de moins de 48 h. */
export function formatSourceDate(
  iso: string | undefined,
  now: Date = new Date(),
  timeZone?: string,
): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return undefined;
  const age = ageInDays(iso, now) ?? Infinity;
  const options: Intl.DateTimeFormatOptions =
    age >= -1 && age < 2
      ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }
      : { day: 'numeric', month: 'short', year: 'numeric', timeZone };
  return new Intl.DateTimeFormat('fr-FR', options).format(date);
}

/** « jeudi 1 octobre 2026, 21:30 » dans le fuseau du PC (ou celui demandé). */
export function formatCurrentDateTime(now: Date = new Date(), timeZone?: string): string {
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(now);
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(now);
  return `${day}, ${time}`;
}

export function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
