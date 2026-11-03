import type { HomeLocation } from '../settings.js';
import { detectCurrentInfoIntent, extractCity, type CurrentInfoPlan } from './currentInfo.js';

export const LOCATION_ASK_REPLY = 'Pour quel endroit ?';

const LOCAL_PLACE = String.raw`\b(?:près de chez moi|autour de chez moi|dans ma ville|pharmacie de garde|ouvert maintenant|ouvert ce soir|actualit[ée]s locales|infos locales|nouvelles locales|circulation|embouteillages|bouchons|trafic(?: routier| actuel| maintenant)?)\b`;

function rx(source: string, flags = 'iu'): RegExp {
  return new RegExp(source, flags);
}

export function isLocalPlaceQuestion(text: string): boolean {
  return rx(LOCAL_PLACE).test(text);
}

export function needsNamedPlace(plan: CurrentInfoPlan, text: string): boolean {
  if (extractCity(text)) return false;
  if (plan.city) return false;
  if (plan.kind === 'weather') return true;
  return isLocalPlaceQuestion(text);
}

export type CurrentInfoTurnPlan =
  | { action: 'none' }
  | { action: 'ask' }
  | { action: 'search'; plan: CurrentInfoPlan };

function appendTown(query: string, label: string): string {
  const town = label.trim();
  if (!town) return query;
  const lower = query.toLowerCase();
  if (lower.includes(town.toLowerCase())) return query;
  return `${query} ${town}`.trim().slice(0, 220);
}

function buildLocalPlan(text: string): CurrentInfoPlan {
  const query = text.replace(/[?!.]+$/u, '').trim().slice(0, 220) || text.trim();
  return {
    kind: 'generic',
    query,
    newsQuery: query,
    freshness: 'week',
    preferNews: false,
    complex: false,
    researchQueries: [],
  };
}

/**
 * Prépare le tour de recherche d'actualité : lieu « Chez moi » ou question
 * « Pour quel endroit ? » si le lieu manque. Sans `home`, le comportement
 * des tests figés sur `detectCurrentInfoIntent` seul est conservé tant qu'on
 * n'appelle pas cette fonction.
 */
export function planCurrentInfoTurn(
  prompt: string,
  now: Date,
  home?: HomeLocation | null,
): CurrentInfoTurnPlan {
  let plan = detectCurrentInfoIntent(prompt, now);
  if (!plan && isLocalPlaceQuestion(prompt)) {
    plan = buildLocalPlan(prompt);
  }
  if (!plan) return { action: 'none' };

  const namedCity = plan.city ?? extractCity(prompt);
  if (namedCity) {
    return { action: 'search', plan: { ...plan, city: namedCity } };
  }

  if (!needsNamedPlace(plan, prompt)) {
    return { action: 'search', plan };
  }

  if (!home?.label?.trim()) {
    return { action: 'ask' };
  }

  const label = home.label.trim();
  const withHome: CurrentInfoPlan = {
    ...plan,
    city: label,
    query: appendTown(plan.query, label),
    newsQuery: plan.kind === 'weather' ? `météo ${label}` : appendTown(plan.newsQuery, label),
    homeCoordinates: { latitude: home.latitude, longitude: home.longitude, label },
  };
  return { action: 'search', plan: withHome };
}

export function weatherFocusFromQuestion(text: string, now: Date): 'now' | 'today' | 'tomorrow' | number | undefined {
  const normalized = text.toLowerCase();
  if (/\bdemain\b/u.test(normalized)) return 'tomorrow';
  if (/\bce week-?end\b/u.test(normalized)) {
    // Samedi ou dimanche : c'est déjà le week-end, donc aujourd'hui (pas le suivant).
    const day = now.getDay();
    if (day === 6 || day === 0) return 'today';
    return 6 - day;
  }
  const weekday = normalized.match(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/u);
  if (weekday) {
    const names = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const target = names.indexOf(weekday[1] ?? '');
    if (target >= 0) {
      const today = now.getDay();
      let offset = (target - today + 7) % 7;
      if (offset === 0 && !/\baujourd'hui\b/u.test(normalized)) offset = 7;
      return offset;
    }
  }
  if (/\b(?:aujourd'hui|ce soir|ce matin|cet apr[èe]s-midi|cette nuit|maintenant)\b/u.test(normalized)) {
    return 'today';
  }
  if (/\b(?:m[ée]t[ée]o|temps|pleuvoir|neiger|temp[ée]rature)\b/u.test(normalized)) {
    return 'now';
  }
  return undefined;
}
