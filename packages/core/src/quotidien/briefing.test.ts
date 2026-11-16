import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import {
  BRIEFING_GUST_KMH,
  BRIEFING_RAIN_MM_PER_HOUR,
  composeBriefing,
  fetchBriefingWeather,
  lookupBriefingPlace,
  shouldGiveBriefing,
  type BriefingFacts,
} from './briefing.js';

/** Phrases et lieux marqués synthetique-test. Aucune ville réelle. */
const NOW = new Date(2026, 10, 12, 7, 30, 0);
const WINDOW = { enabled: true, fromHour: 6, toHour: 10 };

function facts(partial: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    now: NOW,
    weather: {
      place: 'Ville-Test',
      rainMmPerHour: 0,
      rainHours: '',
      gustKmh: 20,
      tempMin: 8,
      tempMax: 14,
    },
    appointments: ['10 h, rendez-vous synthetique-test'],
    pendingNotes: [],
    night: [],
    rainMmPerHour: BRIEFING_RAIN_MM_PER_HOUR,
    gustKmh: BRIEFING_GUST_KMH,
    voice: false,
    ...partial,
  };
}

describe('briefing du matin (synthetique-test)', () => {
  it('parseSettings({}) ne gagne pas briefing', () => {
    expect(parseSettings({})).not.toHaveProperty('briefing');
  });

  it('« mon briefing » et « quoi de neuf ce matin » lancent le briefing', () => {
    expect(shouldGiveBriefing({ text: 'Jarvis, mon briefing', now: NOW, window: WINDOW, offeredOn: null })).toBe(true);
    expect(shouldGiveBriefing({ text: 'quoi de neuf ce matin ?', now: NOW, window: WINDOW, offeredOn: '2026-11-12' })).toBe(true);
  });

  it('« bonjour » seul, le matin, une seule fois ; l’après-midi reste une salutation', () => {
    expect(shouldGiveBriefing({ text: 'bonjour Jarvis', now: NOW, window: WINDOW, offeredOn: null })).toBe(true);
    expect(shouldGiveBriefing({ text: 'bonjour', now: NOW, window: WINDOW, offeredOn: '2026-11-12' })).toBe(false);
    const afternoon = new Date(2026, 10, 12, 15, 0, 0);
    expect(shouldGiveBriefing({ text: 'bonjour', now: afternoon, window: WINDOW, offeredOn: null })).toBe(false);
    expect(shouldGiveBriefing({ text: 'bonjour ouvre le dossier', now: NOW, window: WINDOW, offeredOn: null })).toBe(false);
  });

  it('gabarit : météo, alerte, agenda, source manquante, version courte', () => {
    const calm = composeBriefing(facts());
    expect(calm.text).toContain('Ville-Test');
    expect(calm.text).toContain('pas de pluie');
    expect(calm.text).toContain('rendez-vous synthetique-test');
    expect(calm.text).not.toContain('Alerte couvreur');

    const wet = composeBriefing(
      facts({
        weather: {
          place: 'Ville-Test',
          rainMmPerHour: 3,
          rainHours: '14 h à 16 h',
          gustKmh: 62,
          tempMin: 6,
          tempMax: 9,
        },
      }),
    );
    expect(wet.text).toContain('Alerte couvreur');
    expect(wet.text).toContain('3 mm/h');
    expect(wet.text).toContain('62 km/h');

    const missing = composeBriefing(facts({ weather: null, appointments: null, voice: true }));
    expect(missing.text).toContain('La météo ne répond pas.');
    expect(missing.text).toContain("L'agenda Google n'est pas branché.");
    expect(missing.short).toBe(true);
    expect(missing.text.split('. ').length).toBeLessThanOrEqual(4);
  });

  it('Open-Meteo factice : pluie, rafales, heures (synthetique-test)', async () => {
    const weather = await fetchBriefingWeather({
      place: 'Ville-Test',
      latitude: 0,
      longitude: 0,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            hourly: {
              precipitation: [0, 2.5, 0],
              wind_gusts_10m: [10, 40, 55],
              temperature_2m: [6.2, 11.4, 9],
            },
          }),
        ),
    });
    expect(weather.place).toBe('Ville-Test');
    expect(weather.rainMmPerHour).toBe(2.5);
    expect(weather.rainHours).toBe('1 h à 1 h');
    expect(weather.gustKmh).toBe(55);
    expect(weather.tempMin).toBe(6);
    expect(weather.tempMax).toBe(11);
  });

  it('lieu nommé : le géocodage factice ne contient aucune ville réelle', async () => {
    const place = await lookupBriefingPlace('Ville-Test', async () =>
      new Response(JSON.stringify({ results: [{ latitude: 1.5, longitude: 2.5 }] })),
    );
    expect(place).toEqual({ latitude: 1.5, longitude: 2.5 });
    const missing = await lookupBriefingPlace('Nulle-Part', async () => new Response(JSON.stringify({ results: [] })));
    expect(missing).toBeNull();
  });

  it('coupé : rien ne part', () => {
    expect(shouldGiveBriefing({ text: 'mon briefing', now: NOW, window: { enabled: false }, offeredOn: null })).toBe(false);
  });
});
