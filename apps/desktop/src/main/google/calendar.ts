import {
  formatFrenchRange,
  hasTime,
  localDateTimeFromDate,
  nextDay,
  parseFrenchDateTime,
  resolveCalendarPeriod,
  resolveEventTiming,
  toDateString,
  toLocalDate,
  toLocalIso,
  type CalendarPeriod,
  type LocalDateTime,
} from '@jarvis/core';
import { GoogleError, verificationFailed } from './errors.js';
import type { GoogleActionResult, GoogleWorkspaceContext } from './context.js';
import { normalize, sameText, truncate } from './context.js';

const CALENDAR = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface EventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface CalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  htmlLink?: string;
}

export interface CalendarListInput {
  period?: CalendarPeriod;
  from?: string;
  to?: string;
  query?: string;
  maxResults?: number;
}

export interface CalendarCreateInput {
  title: string;
  start: string;
  end?: string;
  durationMinutes?: number;
  allDay?: boolean;
  location?: string;
  description?: string;
}

export interface CalendarUpdateInput {
  eventId: string;
  eventTitle: string;
  title?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  location?: string;
  description?: string;
}

export interface CalendarDeleteInput {
  eventId: string;
  eventTitle: string;
}

function toLocal(time: EventTime | undefined): LocalDateTime | null {
  if (!time) return null;
  if (time.date) {
    const [year, month, day] = time.date.split('-').map(Number);
    if (!year || !month || !day) return null;
    return { year, month, day };
  }
  if (time.dateTime) {
    const date = new Date(time.dateTime);
    return Number.isNaN(date.getTime()) ? null : localDateTimeFromDate(date);
  }
  return null;
}

export function describeEventWhen(event: CalendarEvent): string {
  const start = toLocal(event.start);
  if (!start) return '(horaire inconnu)';
  return formatFrenchRange(start, toLocal(event.end));
}

function payloadTime(value: LocalDateTime, allDay: boolean, timeZone: string): EventTime {
  return allDay ? { date: toDateString(value) } : { dateTime: toLocalIso(value), timeZone };
}

function sameStart(event: CalendarEvent, expected: LocalDateTime, allDay: boolean): boolean {
  if (allDay) return event.start?.date === toDateString(expected);
  const actual = event.start?.dateTime ? Date.parse(event.start.dateTime) : NaN;
  return actual === toLocalDate(expected).getTime();
}

function titleMatches(actual: string | undefined, given: string): boolean {
  const a = normalize(actual ?? '');
  const b = normalize(given);
  if (!b) return false;
  return a === b || (b.length >= 3 && (a.includes(b) || b.includes(a)) && a.length > 0);
}

function invalid(message: string): GoogleError {
  return new GoogleError('invalid_request', message, { service: 'calendar' });
}

export class CalendarService {
  constructor(private readonly ctx: GoogleWorkspaceContext) {}

  async list(input: CalendarListInput): Promise<GoogleActionResult> {
    this.ctx.account.ensureRead('calendar');
    const now = this.ctx.now();
    let start: Date;
    let end: Date;
    let label: string;
    if (input.from?.trim()) {
      const from = parseFrenchDateTime(input.from, now);
      if (!from) throw invalid(`Je n'ai pas compris la date « ${input.from} ». Rien n'a été lu.`);
      const to = input.to?.trim() ? parseFrenchDateTime(input.to, now) : null;
      if (input.to?.trim() && !to) throw invalid(`Je n'ai pas compris la date « ${input.to} ». Rien n'a été lu.`);
      start = toLocalDate(hasTime(from) ? from : { ...from, hour: 0, minute: 0 });
      end = to ? toLocalDate(hasTime(to) ? to : nextDay(to)) : toLocalDate(nextDay(from));
      label = to ? `du ${input.from} au ${input.to}` : `le ${input.from}`;
    } else {
      const window = resolveCalendarPeriod(input.period ?? 'next7days', now);
      ({ start, end, label } = window);
    }
    if (end <= start) throw invalid("La fin de la période doit être après son début. Rien n'a été lu.");

    const data = await this.ctx.api.json<{ items?: CalendarEvent[] }>('calendar', CALENDAR, {
      query: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: Math.min(Math.max(input.maxResults ?? 25, 1), 50),
        q: input.query?.trim() || undefined,
      },
    });
    const items = (data?.items ?? []).filter((event) => event.status !== 'cancelled');
    if (items.length === 0) return { text: `Rien dans ton agenda ${label}.`, data: { events: [] } };
    const lines = items.map((event) => {
      const where = event.location ? ` — ${event.location}` : '';
      return `- ${describeEventWhen(event)} — « ${event.summary || '(sans titre)'} »${where} (id : ${event.id})`;
    });
    return {
      text: truncate([`Agenda ${label} — ${items.length} événement(s) :`, ...lines].join('\n')),
      data: { events: items.map((event) => ({ id: event.id, title: event.summary, when: describeEventWhen(event) })) },
    };
  }

  async create(input: CalendarCreateInput): Promise<GoogleActionResult> {
    this.ctx.account.ensureWrite('calendar');
    const timing = resolveEventTiming(input, this.ctx.now());
    if (!timing.ok) throw invalid(timing.error);
    const zone = this.ctx.timeZone();
    const title = input.title.trim();
    const created = await this.ctx.api.json<CalendarEvent>('calendar', CALENDAR, {
      method: 'POST',
      body: {
        summary: title,
        ...(input.location?.trim() ? { location: input.location.trim() } : {}),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        start: payloadTime(timing.start, timing.allDay, zone),
        end: payloadTime(timing.end, timing.allDay, zone),
      },
    });
    if (!created?.id) throw verificationFailed('calendar', "la création de l'événement", 'events.insert sans id');
    const check = await this.reread(created.id, "la création de l'événement");
    if (!sameText(check.summary ?? '', title) || !sameStart(check, timing.start, timing.allDay)) {
      throw verificationFailed('calendar', "l'événement (titre ou horaire différent)", `event ${created.id} relu différent`);
    }
    return {
      text: `Événement créé et vérifié dans l'agenda : « ${title} », ${describeEventWhen(check)}. (id : ${created.id})`,
      data: { eventId: created.id, link: check.htmlLink },
    };
  }

  async update(input: CalendarUpdateInput): Promise<GoogleActionResult> {
    this.ctx.account.ensureWrite('calendar');
    const current = await this.ctx.api.json<CalendarEvent>('calendar', `${CALENDAR}/${encodeURIComponent(input.eventId)}`);
    this.assertIdentity(current, input.eventId, input.eventTitle, "modifié");

    const patch: Record<string, unknown> = {};
    if (input.title?.trim()) patch.summary = input.title.trim();
    if (input.location !== undefined) patch.location = input.location.trim();
    if (input.description !== undefined) patch.description = input.description.trim();

    let expectedStart: { value: LocalDateTime; allDay: boolean } | null = null;
    if (input.start?.trim() || input.end?.trim() || input.durationMinutes) {
      const currentStart = toLocal(current.start);
      const currentEnd = toLocal(current.end);
      const wasAllDay = Boolean(current.start?.date);
      const startText = input.start?.trim() || (currentStart ? (wasAllDay ? toDateString(currentStart) : toLocalIso(currentStart)) : '');
      let duration = input.durationMinutes;
      if (!input.end?.trim() && duration === undefined && currentStart && currentEnd && !wasAllDay) {
        duration = Math.round((toLocalDate(currentEnd).getTime() - toLocalDate(currentStart).getTime()) / 60_000);
      }
      const timing = resolveEventTiming(
        { start: startText, end: input.end, durationMinutes: duration, allDay: wasAllDay && !input.start?.trim() ? true : undefined },
        this.ctx.now(),
      );
      if (!timing.ok) throw invalid(timing.error);
      const zone = this.ctx.timeZone();
      patch.start = payloadTime(timing.start, timing.allDay, zone);
      patch.end = payloadTime(timing.end, timing.allDay, zone);
      expectedStart = { value: timing.start, allDay: timing.allDay };
    }
    if (Object.keys(patch).length === 0) throw invalid("Rien à modifier : donne un nouveau titre, horaire, lieu ou description. Rien n'a été modifié.");

    await this.ctx.api.json<CalendarEvent>('calendar', `${CALENDAR}/${encodeURIComponent(input.eventId)}`, {
      method: 'PATCH',
      body: patch,
    });
    const check = await this.reread(input.eventId, "la modification de l'événement");
    const ok =
      (patch.summary === undefined || sameText(check.summary ?? '', String(patch.summary))) &&
      (patch.location === undefined || sameText(check.location ?? '', String(patch.location))) &&
      (patch.description === undefined || sameText(check.description ?? '', String(patch.description))) &&
      (!expectedStart || sameStart(check, expectedStart.value, expectedStart.allDay));
    if (!ok) throw verificationFailed('calendar', 'la modification (valeurs relues différentes)', `event ${input.eventId} relu différent`);
    return {
      text: `Événement modifié et vérifié : « ${check.summary ?? ''} », ${describeEventWhen(check)}. (id : ${input.eventId})`,
      data: { eventId: input.eventId },
    };
  }

  async remove(input: CalendarDeleteInput): Promise<GoogleActionResult> {
    this.ctx.account.ensureWrite('calendar');
    const url = `${CALENDAR}/${encodeURIComponent(input.eventId)}`;
    const current = await this.ctx.api.json<CalendarEvent>('calendar', url);
    if (current?.status === 'cancelled') {
      return { text: `L'événement ${input.eventId} était déjà supprimé. Rien n'a été changé.`, data: { eventId: input.eventId } };
    }
    this.assertIdentity(current, input.eventId, input.eventTitle, 'supprimé');
    const when = describeEventWhen(current);
    await this.ctx.api.json('calendar', url, { method: 'DELETE' });

    let gone = false;
    try {
      const check = await this.ctx.api.json<CalendarEvent>('calendar', url);
      gone = check?.status === 'cancelled';
    } catch (error) {
      if (error instanceof GoogleError && error.kind === 'not_found') gone = true;
      else throw verificationFailed('calendar', 'la suppression (relecture impossible)', `relecture ${input.eventId}: ${error instanceof GoogleError ? error.kind : 'erreur'}`);
    }
    if (!gone) throw verificationFailed('calendar', "la suppression (l'événement est toujours là)", `event ${input.eventId} encore présent`);
    return {
      text: `Événement supprimé et vérifié : « ${current.summary ?? ''} », ${when}.`,
      data: { eventId: input.eventId },
    };
  }

  private assertIdentity(event: CalendarEvent, eventId: string, eventTitle: string, verb: string): void {
    if (!titleMatches(event?.summary, eventTitle)) {
      throw new GoogleError(
        'mismatch',
        `L'événement ${eventId} s'appelle « ${event?.summary ?? '(sans titre)'} », pas « ${eventTitle} ». Rien n'a été ${verb}.`,
        { service: 'calendar', technicalDetail: `titre attendu différent pour ${eventId}` },
      );
    }
  }

  private async reread(eventId: string, what: string): Promise<CalendarEvent> {
    try {
      return await this.ctx.api.json<CalendarEvent>('calendar', `${CALENDAR}/${encodeURIComponent(eventId)}`);
    } catch (error) {
      throw verificationFailed('calendar', what, `relecture ${eventId}: ${error instanceof GoogleError ? error.kind : 'erreur'}`);
    }
  }
}
