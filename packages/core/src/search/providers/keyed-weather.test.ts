import { describe, expect, it } from 'vitest';
import { TavilySearchProvider } from './tavily.js';
import { describeWeatherCode, fetchOpenMeteoWeather, localTimeToIso } from './openMeteo.js';

const SECRET = 'tvly-SECRET-0123456789';

function capture(status: number, body: unknown, seen: { url: string; init?: RequestInit }[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe('Tavily (clé optionnelle)', () => {
  it('envoie la clé seulement dans Authorization et demande les dates de publication', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const provider = new TavilySearchProvider(
      { provider: 'tavily', apiKey: SECRET },
      capture(200, { results: [{ title: 'PSG 5-0', url: 'https://www.lequipe.fr/a', content: 'Victoire.', published_date: 'Thu, 01 Oct 2026 20:00:00 GMT' }] }, seen),
    );
    const response = await provider.search({ query: 'PSG', limit: 3, freshness: 'week' });
    const body = JSON.parse(String(seen[0]?.init?.body)) as Record<string, unknown>;
    expect(seen[0]?.url).toBe('https://api.tavily.com/search');
    expect((seen[0]?.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body).toMatchObject({ query: 'PSG', max_results: 3, topic: 'news', time_range: 'week', include_published_date: true });
    expect(response.results[0]).toMatchObject({ title: 'PSG 5-0', source: 'lequipe.fr', publishedAt: '2026-10-01T20:00:00.000Z' });
  });

  it('clé refusée : message sans la clé', async () => {
    const provider = new TavilySearchProvider({ provider: 'tavily', apiKey: SECRET }, capture(401, { detail: 'bad key' }, []));
    const error = await provider.search({ query: 'x' }).catch((caught: Error) => caught);
    expect(String(error)).toMatch(/Clé API Tavily invalide/);
    expect(String(error)).not.toContain(SECRET);
  });

  it('sans clé : erreur immédiate, aucune requête', async () => {
    const seen: { url: string }[] = [];
    const provider = new TavilySearchProvider({ provider: 'tavily', apiKey: '' }, capture(200, {}, seen));
    await expect(provider.search({ query: 'x' })).rejects.toThrow(/Clé API manquante/);
    expect(seen).toHaveLength(0);
  });
});

describe('Open-Meteo (météo sans clé)', () => {
  it('géocode la ville puis résume la mesure et la prévision du jour, datée', async () => {
    const seen: { url: string }[] = [];
    let call = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push({ url: String(url) });
      call += 1;
      const body =
        call === 1
          ? { results: [{ name: 'Paris', latitude: 48.85, longitude: 2.35, country: 'France', admin1: 'Île-de-France' }] }
          : {
              utc_offset_seconds: 7200,
              current: { time: '2026-10-01T23:30', temperature_2m: 16.8, apparent_temperature: 16.3, weather_code: 0, wind_speed_10m: 3.7 },
              daily: {
                time: ['2026-10-01', '2026-10-02'],
                weather_code: [80, 3],
                temperature_2m_max: [21.2, 21.9],
                temperature_2m_min: [16.5, 13.2],
                precipitation_probability_max: [100, 0],
              },
            };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const item = await fetchOpenMeteoWeather('Paris', { fetchImpl });
    expect(seen[0]?.url).toContain('geocoding-api.open-meteo.com');
    expect(seen[1]?.url).toContain('latitude=48.85');
    expect(item.title).toBe('Météo Paris, Île-de-France, France');
    expect(item.snippet).toContain('Maintenant : 17 °C (ressenti 16 °C), ciel dégagé, vent 4 km/h.');
    expect(item.snippet).toContain("Aujourd'hui : 17 à 21 °C, averses faibles, risque de pluie 100 %.");
    expect(item.snippet).toContain('Demain : 13 à 22 °C, ciel couvert');
    expect(item.publishedAt).toBe('2026-10-01T21:30:00.000Z');
    expect(item.publisher).toBe('Open-Meteo');
  });

  it('ville inconnue : erreur claire', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchOpenMeteoWeather('Zzzz', { fetchImpl })).rejects.toThrow(/ne connaît pas la ville/);
  });

  it('codes WMO en français et heure locale convertie', () => {
    expect(describeWeatherCode(95)).toBe('orage');
    expect(describeWeatherCode(undefined)).toBe('temps inconnu');
    expect(localTimeToIso('2026-10-01T12:00', 3600)).toBe('2026-10-01T11:00:00.000Z');
  });
});
