/**
 * Dates de l'agenda dans l'heure locale du PC. Un petit modèle local écrit
 * volontiers « demain 14h », « jeudi à 9h30 » ou un ISO suivi d'un « Z »
 * qu'il n'a pas voulu dire : tout est ramené à une heure murale locale, que
 * la carte de confirmation affiche en clair avant la moindre écriture.
 */

export interface LocalDateTime {
  year: number;
  /** 1 à 12 */
  month: number;
  day: number;
  /** Absent : journée entière. */
  hour?: number;
  minute?: number;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = [
  'janvier',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'decembre',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function fromDate(date: Date, withTime: boolean): LocalDateTime {
  const base: LocalDateTime = {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
  if (withTime) {
    base.hour = date.getHours();
    base.minute = date.getMinutes();
  }
  return base;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function isValidDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseTime(text: string): { hour: number; minute: number } | null {
  if (/\bmidi\b/.test(text)) return { hour: 12, minute: 0 };
  if (/\bminuit\b/.test(text)) return { hour: 0, minute: 0 };
  const match =
    text.match(/(?:^|[^\d])(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?![\d])/) ??
    text.match(/(?:^|\s)a\s+(\d{1,2})(?:\s|$)/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return null;
  let adjusted = hour;
  if (/\b(de l'apres-midi|du soir|pm)\b/.test(text) && hour < 12) adjusted = hour + 12;
  return { hour: adjusted, minute };
}

/**
 * Lit une date (et une heure facultative) en français ou en ISO. `null` si
 * rien de sûr. Un fuseau ISO (`Z`, `+02:00`) est ignoré : l'heure écrite est
 * prise comme heure locale.
 */
export function parseFrenchDateTime(input: string, now: Date = new Date()): LocalDateTime | null {
  const raw = input.trim();
  if (!raw) return null;

  const iso = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (!isValidDay(year, month, day)) return null;
    if (iso[4] === undefined) return { year, month, day };
    const hour = Number(iso[4]);
    const minute = Number(iso[5]);
    if (hour > 23 || minute > 59) return null;
    return { year, month, day, hour, minute };
  }

  const text = normalize(raw);
  const time = parseTime(text.replace(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g, ' '));
  let date: LocalDateTime | null = null;

  if (/\bapres[- ]demain\b/.test(text)) date = fromDate(addDays(now, 2), false);
  else if (/\bdemain\b/.test(text)) date = fromDate(addDays(now, 1), false);
  else if (/\baujourd'hui\b|\bce soir\b|\bcet apres-midi\b|\bce matin\b/.test(text)) date = fromDate(now, false);

  if (!date) {
    const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (numeric) {
      const day = Number(numeric[1]);
      const month = Number(numeric[2]);
      let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
      if (year < 100) year += 2000;
      if (!numeric[3] && new Date(year, month - 1, day) < addDays(now, 0)) year += 1;
      if (isValidDay(year, month, day)) date = { year, month, day };
    }
  }

  if (!date) {
    const named = text.match(/\b(\d{1,2}|1er)\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?\b/);
    if (named) {
      const day = named[1] === '1er' ? 1 : Number(named[1]);
      const month = MONTHS.indexOf(named[2]!) + 1;
      let year = named[3] ? Number(named[3]) : now.getFullYear();
      if (!named[3] && new Date(year, month - 1, day) < addDays(now, 0)) year += 1;
      if (isValidDay(year, month, day)) date = { year, month, day };
    }
  }

  if (!date) {
    const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b`).test(text));
    if (weekday >= 0) {
      let offset = (weekday - now.getDay() + 7) % 7;
      if (/\bprochain\b/.test(text) && offset === 0) offset = 7;
      date = fromDate(addDays(now, offset), false);
    }
  }

  if (!date) return null;
  if (time) return { ...date, hour: time.hour, minute: time.minute };
  return date;
}

export function hasTime(value: LocalDateTime): boolean {
  return value.hour !== undefined;
}

export function toLocalDate(value: LocalDateTime): Date {
  return new Date(value.year, value.month - 1, value.day, value.hour ?? 0, value.minute ?? 0, 0, 0);
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** `2026-10-02` */
export function toDateString(value: LocalDateTime): string {
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

/** `2026-10-02T14:00:00`, sans fuseau : Google l'accompagne de `timeZone`. */
export function toLocalIso(value: LocalDateTime): string {
  return `${toDateString(value)}T${pad(value.hour ?? 0)}:${pad(value.minute ?? 0)}:00`;
}

export function localDateTimeFromDate(date: Date): LocalDateTime {
  return fromDate(date, true);
}

export function addMinutes(value: LocalDateTime, minutes: number): LocalDateTime {
  const date = toLocalDate(value);
  date.setMinutes(date.getMinutes() + minutes);
  return fromDate(date, true);
}

export function nextDay(value: LocalDateTime): LocalDateTime {
  return fromDate(addDays(toLocalDate(value), 1), false);
}

export interface EventTimingInput {
  start: string;
  end?: string;
  durationMinutes?: number;
  allDay?: boolean;
}

export type EventTiming =
  | { ok: true; start: LocalDateTime; end: LocalDateTime; allDay: boolean }
  | { ok: false; error: string };

const MAX_EVENT_MINUTES = 14 * 24 * 60;

function dateOnly(value: LocalDateTime): LocalDateTime {
  return { year: value.year, month: value.month, day: value.day };
}

/**
 * Début et fin d'un événement, tels que la carte de confirmation les
 * affiche et que Google les reçoit. Sans fin : 1 h (ou la durée donnée),
 * journée entière si aucune heure n'est dite. Fin exclusive pour une
 * journée entière, comme l'API Agenda.
 */
export function resolveEventTiming(input: EventTimingInput, now: Date = new Date()): EventTiming {
  const parsed = parseFrenchDateTime(input.start, now);
  if (!parsed) {
    return {
      ok: false,
      error: `Je n'ai pas compris la date de début « ${input.start} ». Donne-la comme « demain 14h » ou « 2026-10-02T14:00 ». Rien n'a été fait.`,
    };
  }
  const allDay = input.allDay === true || !hasTime(parsed);
  const start = allDay ? dateOnly(parsed) : parsed;
  let end: LocalDateTime;

  if (input.end?.trim()) {
    const raw = input.end.trim();
    const endParsed =
      parseFrenchDateTime(raw, now) ??
      parseFrenchDateTime(`${pad(start.day)}/${pad(start.month)}/${start.year} ${raw}`, now);
    if (!endParsed || (!allDay && !hasTime(endParsed))) {
      return { ok: false, error: `Je n'ai pas compris l'heure de fin « ${raw} ». Rien n'a été fait.` };
    }
    end = allDay ? nextDay(dateOnly(endParsed)) : endParsed;
  } else if (allDay) {
    end = nextDay(start);
  } else {
    const minutes = Math.round(input.durationMinutes ?? 60);
    end = addMinutes(start, Math.min(Math.max(minutes, 5), MAX_EVENT_MINUTES));
  }

  if (toLocalDate(end).getTime() <= toLocalDate(start).getTime()) {
    return { ok: false, error: "La fin de l'événement doit être après son début. Rien n'a été fait." };
  }
  return { ok: true, start, end, allDay };
}

export type CalendarPeriod = 'today' | 'tomorrow' | 'week' | 'next7days' | 'weekend' | 'month';

export const CALENDAR_PERIODS: CalendarPeriod[] = ['today', 'tomorrow', 'week', 'next7days', 'weekend', 'month'];

export interface CalendarWindow {
  start: Date;
  end: Date;
  label: string;
}

/** Fenêtre de lecture de l'agenda, en heure locale. */
export function resolveCalendarPeriod(period: CalendarPeriod, now: Date = new Date()): CalendarWindow {
  const today = addDays(now, 0);
  switch (period) {
    case 'today':
      return { start: today, end: addDays(today, 1), label: "aujourd'hui" };
    case 'tomorrow':
      return { start: addDays(today, 1), end: addDays(today, 2), label: 'demain' };
    case 'week': {
      const toMonday = (today.getDay() + 6) % 7;
      const monday = addDays(today, -toMonday);
      return { start: today, end: addDays(monday, 7), label: 'cette semaine' };
    }
    case 'weekend': {
      const toSaturday = (6 - today.getDay() + 7) % 7;
      const saturday = today.getDay() === 0 ? addDays(today, -1) : addDays(today, toSaturday);
      const start = saturday < today ? today : saturday;
      return { start, end: addDays(saturday, 2), label: 'ce week-end' };
    }
    case 'month':
      return { start: today, end: new Date(today.getFullYear(), today.getMonth() + 1, 1), label: 'ce mois-ci' };
    case 'next7days':
    default:
      return { start: today, end: addDays(today, 7), label: 'les 7 prochains jours' };
  }
}

/** « jeudi 2 octobre 2026 » ou « jeudi 2 octobre 2026 à 14:00 ». */
export function formatFrenchDateTime(value: LocalDateTime): string {
  const date = toLocalDate(value);
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  if (!hasTime(value)) return day;
  return `${day} à ${pad(value.hour ?? 0)}:${pad(value.minute ?? 0)}`;
}

/** « jeudi 2 octobre 2026 de 14:00 à 15:00 », « … (journée entière) ». */
export function formatFrenchRange(start: LocalDateTime, end: LocalDateTime | null): string {
  if (!hasTime(start)) {
    if (!end) return `${formatFrenchDateTime(start)} (journée entière)`;
    const last = fromDate(addDays(toLocalDate(end), -1), false);
    const sameDay = toDateString(last) === toDateString(start);
    return sameDay
      ? `${formatFrenchDateTime(start)} (journée entière)`
      : `du ${formatFrenchDateTime(start)} au ${formatFrenchDateTime(last)} (journées entières)`;
  }
  if (!end || !hasTime(end)) return formatFrenchDateTime(start);
  if (toDateString(start) === toDateString(end)) {
    return `${formatFrenchDateTime({ ...start, hour: undefined, minute: undefined })} de ${pad(start.hour ?? 0)}:${pad(start.minute ?? 0)} à ${pad(end.hour ?? 0)}:${pad(end.minute ?? 0)}`;
  }
  return `du ${formatFrenchDateTime(start)} au ${formatFrenchDateTime(end)}`;
}
