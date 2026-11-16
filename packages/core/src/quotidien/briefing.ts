/**
 * Briefing du matin. Gabarits seulement : aucun modèle, aucune valeur inventée.
 * Coupé tant que `settings.briefing.enabled` n'est pas vrai.
 */

export const BRIEFING_RAIN_MM_PER_HOUR = 1;
export const BRIEFING_GUST_KMH = 50;
export const BRIEFING_FROM_HOUR = 6;
export const BRIEFING_TO_HOUR = 10;

export interface BriefingWindow {
  enabled: boolean;
  fromHour?: number;
  toHour?: number;
  rainMmPerHour?: number;
  gustKmh?: number;
}

export interface BriefingWeather {
  /** Nom du lieu, tel que l'utilisateur l'a dit ou « Chez moi ». */
  place: string;
  /** Pluie la plus forte de la journée, en mm/h. */
  rainMmPerHour: number;
  /** Heures de pluie, déjà en français. Vide s'il ne pleut pas. */
  rainHours: string;
  gustKmh: number;
  tempMin: number;
  tempMax: number;
}

export interface BriefingFacts {
  now: Date;
  weather: BriefingWeather | null;
  /** `null` : Google n'est pas branché. Tableau vide : aucun rendez-vous. */
  appointments: string[] | null;
  pendingNotes: string[];
  /** Lignes déjà rédigées (« 12 exercices ajoutés »). Vide : rien à dire. */
  night: string[];
  rainMmPerHour: number;
  gustKmh: number;
  /** Court pour l'enceinte, long pour la fenêtre. */
  voice: boolean;
}

export interface BriefingReply {
  text: string;
  short: boolean;
}

const FILLERS = new Set(['la', 'vraiment', 'bon', 'eh', 'bah', 'ben', 'ok', 'hein']);

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bare(text: string): string {
  const words = fold(text).split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed && words.length) {
    changed = false;
    if (words[0] === 'jarvis' || FILLERS.has(words[0]!)) {
      words.shift();
      changed = true;
    }
    const last = words.at(-1);
    if (last && (last === 'jarvis' || FILLERS.has(last))) {
      words.pop();
      changed = true;
    }
  }
  return words.join(' ');
}

/** « mon briefing », « quoi de neuf ce matin », ou « bonjour » tout seul. */
export function briefingKind(text: string): 'briefing' | 'bonjour' | null {
  const n = bare(text);
  if (!n) return null;
  if (n === 'bonjour' || n === 'bonjour jarvis') return 'bonjour';
  if (/\bmon briefing\b/.test(n) || n === 'briefing' || /\bquoi de neuf ce matin\b/.test(n)) return 'briefing';
  return null;
}

export function briefingPlace(text: string): string | null {
  const match = text.match(/\bbriefing\s+[àa]\s+([^\s,?.!]+)/iu);
  const place = match?.[1]?.trim();
  return place ? place : null;
}

export function inBriefingWindow(now: Date, window: BriefingWindow): boolean {
  const from = window.fromHour ?? BRIEFING_FROM_HOUR;
  const to = window.toHour ?? BRIEFING_TO_HOUR;
  const hour = now.getHours();
  if (from <= to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}

export function briefingDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * « Bonjour » seul ne lance le briefing que dans la plage, et une seule fois par jour.
 * « Mon briefing » le lance toujours, si le réglage est actif.
 */
export function shouldGiveBriefing(input: {
  text: string;
  now: Date;
  window: BriefingWindow;
  offeredOn: string | null;
}): boolean {
  if (!input.window.enabled) return false;
  const kind = briefingKind(input.text);
  if (kind === 'briefing') return true;
  if (kind !== 'bonjour') return false;
  if (!inBriefingWindow(input.now, input.window)) return false;
  return input.offeredOn !== briefingDay(input.now);
}

function dayLine(now: Date): string {
  const label = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return `Nous sommes ${label}.`;
}

function weatherLine(weather: BriefingWeather, rainLimit: number, gustLimit: number): string[] {
  const rain =
    weather.rainMmPerHour <= 0
      ? 'pas de pluie'
      : `pluie ${weather.rainMmPerHour} mm/h${weather.rainHours ? ` (${weather.rainHours})` : ''}`;
  const lines = [
    `À ${weather.place}, ${weather.tempMin} à ${weather.tempMax} degrés, ${rain}, rafales ${weather.gustKmh} km/h.`,
  ];
  const alerts: string[] = [];
  if (weather.rainMmPerHour > rainLimit) {
    alerts.push(`pluie ${weather.rainMmPerHour} mm/h, au-dessus de ton seuil de ${rainLimit} mm/h`);
  }
  if (weather.gustKmh > gustLimit) {
    alerts.push(`rafales ${weather.gustKmh} km/h, au-dessus de ton seuil de ${gustLimit} km/h`);
  }
  if (alerts.length) lines.push(`Alerte couvreur : ${alerts.join(' ; ')}.`);
  return lines;
}

/** Texte du briefing. Une source absente est dite, jamais inventée. */
export function composeBriefing(facts: BriefingFacts): BriefingReply {
  const lines = [dayLine(facts.now)];
  if (facts.weather) lines.push(...weatherLine(facts.weather, facts.rainMmPerHour, facts.gustKmh));
  else lines.push('La météo ne répond pas.');
  if (facts.appointments === null) lines.push("L'agenda Google n'est pas branché.");
  else if (facts.appointments.length === 0) lines.push("Pas de rendez-vous aujourd'hui.");
  else lines.push(`Aujourd'hui : ${facts.appointments.join(' ; ')}.`);
  if (facts.pendingNotes.length === 0) lines.push('Aucune note en attente.');
  else lines.push(`${facts.pendingNotes.length} note${facts.pendingNotes.length > 1 ? 's' : ''} en attente : ${facts.pendingNotes.join(' ; ')}.`);
  if (facts.night.length) lines.push(`Cette nuit : ${facts.night.join(' ; ')}.`);
  const text = lines.join(' ');
  if (!facts.voice) return { text, short: false };
  return { text: lines.slice(0, 4).join(' '), short: true };
}

interface HourlyForecast {
  precipitation?: number[];
  wind_gusts_10m?: number[];
  temperature_2m?: number[];
}

/** Lieu nommé (« briefing à … »). Aucune ville n'est écrite dans le code. */
export async function lookupBriefingPlace(
  name: string,
  fetchImpl?: typeof fetch,
): Promise<{ latitude: number; longitude: number } | null> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', '1');
  const response = await (fetchImpl ?? fetch)(url);
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: { latitude?: number; longitude?: number }[] };
  const hit = body.results?.[0];
  if (typeof hit?.latitude !== 'number' || typeof hit.longitude !== 'number') return null;
  return { latitude: hit.latitude, longitude: hit.longitude };
}

/** Météo du jour via Open-Meteo. Échoue clairement si le service ne répond pas. */
export async function fetchBriefingWeather(input: {
  place: string;
  latitude: number;
  longitude: number;
  fetchImpl?: typeof fetch;
}): Promise<BriefingWeather> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(input.latitude));
  url.searchParams.set('longitude', String(input.longitude));
  url.searchParams.set('hourly', 'precipitation,wind_gusts_10m,temperature_2m');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timezone', 'auto');
  const response = await (input.fetchImpl ?? fetch)(url);
  if (!response.ok) throw new Error('météo indisponible');
  const body = (await response.json()) as { hourly?: HourlyForecast };
  const hourly = body.hourly ?? {};
  const rain = hourly.precipitation ?? [];
  const gusts = hourly.wind_gusts_10m ?? [];
  const temps = hourly.temperature_2m ?? [];
  const rainMmPerHour = rain.reduce((max, value) => Math.max(max, value), 0);
  const wet = rain
    .map((value, index) => (value > 0 ? index : -1))
    .filter((index) => index >= 0);
  const rainHours =
    wet.length === 0 ? '' : `${wet[0]} h à ${wet[wet.length - 1]} h`;
  const gustKmh = gusts.reduce((max, value) => Math.max(max, value), 0);
  const tempMin = temps.length ? Math.round(Math.min(...temps)) : 0;
  const tempMax = temps.length ? Math.round(Math.max(...temps)) : 0;
  return {
    place: input.place,
    rainMmPerHour: Math.round(rainMmPerHour * 10) / 10,
    rainHours,
    gustKmh: Math.round(gustKmh),
    tempMin,
    tempMax,
  };
}
