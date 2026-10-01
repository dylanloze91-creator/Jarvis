import { fetchSearchText } from '../http.js';
import { SearchProviderError, type SearchResultItem } from '../types.js';

export const OPEN_METEO_LABEL = 'Open-Meteo (météo, sans clé)';

const WMO_FR: Record<number, string> = {
  0: 'ciel dégagé',
  1: 'ciel plutôt dégagé',
  2: 'partiellement nuageux',
  3: 'ciel couvert',
  45: 'brouillard',
  48: 'brouillard givrant',
  51: 'bruine légère',
  53: 'bruine',
  55: 'bruine dense',
  56: 'bruine verglaçante',
  57: 'bruine verglaçante dense',
  61: 'pluie faible',
  63: 'pluie modérée',
  65: 'forte pluie',
  66: 'pluie verglaçante',
  67: 'forte pluie verglaçante',
  71: 'neige faible',
  73: 'neige modérée',
  75: 'forte neige',
  77: 'grains de neige',
  80: 'averses faibles',
  81: 'averses',
  82: 'violentes averses',
  85: 'averses de neige',
  86: 'fortes averses de neige',
  95: 'orage',
  96: 'orage avec grêle',
  99: 'violent orage avec grêle',
};

export function describeWeatherCode(code: number | undefined): string {
  return code === undefined ? 'temps inconnu' : (WMO_FR[code] ?? `code météo ${code}`);
}

interface GeocodingResponse {
  results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[];
}

interface ForecastResponse {
  utc_offset_seconds?: number;
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    precipitation?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
}

function round(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '?' : String(Math.round(value));
}

/**
 * Météo actuelle et du jour pour une ville, via Open-Meteo (gratuit, sans clé
 * ni compte, modèles Météo-France / ECMWF / DWD). Rend un résultat de
 * recherche daté de l'heure de la mesure.
 */
export async function fetchOpenMeteoWeather(
  city: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SearchResultItem> {
  const name = city.trim();
  if (!name) throw new SearchProviderError('Ville manquante pour la météo.');
  const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geoUrl.searchParams.set('name', name);
  geoUrl.searchParams.set('count', '1');
  geoUrl.searchParams.set('language', 'fr');
  geoUrl.searchParams.set('format', 'json');
  const geo = await fetchSearchText(geoUrl.toString(), 'Open-Meteo', {
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    headers: { accept: 'application/json' },
  });
  if (geo.status !== 200) throw new SearchProviderError(`Open-Meteo : géocodage HTTP ${geo.status}.`, geo.status);
  const place = (JSON.parse(geo.text) as GeocodingResponse).results?.[0];
  if (!place) throw new SearchProviderError(`Open-Meteo ne connaît pas la ville « ${name} ».`);

  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.searchParams.set('latitude', String(place.latitude));
  forecastUrl.searchParams.set('longitude', String(place.longitude));
  forecastUrl.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation',
  );
  forecastUrl.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  );
  forecastUrl.searchParams.set('timezone', 'auto');
  forecastUrl.searchParams.set('forecast_days', '2');
  const forecast = await fetchSearchText(forecastUrl.toString(), 'Open-Meteo', {
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    headers: { accept: 'application/json' },
  });
  if (forecast.status !== 200) {
    throw new SearchProviderError(`Open-Meteo : prévisions HTTP ${forecast.status}.`, forecast.status);
  }
  const data = JSON.parse(forecast.text) as ForecastResponse;
  const current = data.current ?? {};
  const daily = data.daily ?? {};
  const where = [place.name, place.admin1, place.country].filter(Boolean).join(', ');

  const parts = [
    `Maintenant : ${round(current.temperature_2m)} °C (ressenti ${round(current.apparent_temperature)} °C), ${describeWeatherCode(current.weather_code)}, vent ${round(current.wind_speed_10m)} km/h.`,
  ];
  if (daily.time?.[0]) {
    parts.push(
      `Aujourd'hui : ${round(daily.temperature_2m_min?.[0])} à ${round(daily.temperature_2m_max?.[0])} °C, ${describeWeatherCode(daily.weather_code?.[0])}, risque de pluie ${round(daily.precipitation_probability_max?.[0])} %.`,
    );
  }
  if (daily.time?.[1]) {
    parts.push(
      `Demain : ${round(daily.temperature_2m_min?.[1])} à ${round(daily.temperature_2m_max?.[1])} °C, ${describeWeatherCode(daily.weather_code?.[1])}, risque de pluie ${round(daily.precipitation_probability_max?.[1])} %.`,
    );
  }

  return {
    title: `Météo ${where}`,
    url: `https://open-meteo.com/en/docs?latitude=${place.latitude}&longitude=${place.longitude}`,
    snippet: parts.join(' '),
    source: 'open-meteo.com',
    publisher: 'Open-Meteo',
    publishedAt: localTimeToIso(current.time, data.utc_offset_seconds),
  };
}

/** `2026-10-01T23:30` + décalage UTC du lieu → ISO 8601 absolu. */
export function localTimeToIso(local: string | undefined, offsetSeconds = 0): string | undefined {
  if (!local) return undefined;
  const time = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time - offsetSeconds * 1000).toISOString();
}
