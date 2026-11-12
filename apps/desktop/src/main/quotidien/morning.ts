/**
 * Briefing branché sur la session. Gabarits seulement.
 * Le jour déjà offert est un fichier à part, pas une clé de réglages.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BRIEFING_GUST_KMH,
  BRIEFING_RAIN_MM_PER_HOUR,
  briefingPlace,
  composeBriefing,
  fetchBriefingWeather,
  briefingDay,
  lookupBriefingPlace,
  shouldGiveBriefing,
  type BriefingWindow,
  type Settings,
} from '@jarvis/core';

export function createMorningBriefing(
  userData: () => string,
  getSettings: () => Settings,
  extras?: { appointments?: () => Promise<string[] | null>; night?: () => Promise<string[]> },
) {
  return async (input: { text: string; voice: boolean }): Promise<string | null> => {
    const settings = getSettings();
    const window = settings.briefing;
    if (!window?.enabled) return null;
    const now = new Date();
    const offeredOn = await readOffered(userData());
    const active: BriefingWindow = {
      enabled: true,
      fromHour: window.fromHour,
      toHour: window.toHour,
      rainMmPerHour: window.rainMmPerHour,
      gustKmh: window.gustKmh,
    };
    if (!shouldGiveBriefing({ text: input.text, now, window: active, offeredOn })) return null;
    const named = briefingPlace(input.text);
    const home = settings.homeLocation;
    const placeName = named ?? home?.label ?? null;
    let latitude = home?.latitude;
    let longitude = home?.longitude;
    if (named) {
      const found = await lookupBriefingPlace(named).catch(() => null);
      if (found) {
        latitude = found.latitude;
        longitude = found.longitude;
      } else {
        latitude = undefined;
      }
    }
    let weather = null;
    if (placeName && latitude !== undefined && longitude !== undefined) {
      weather = await fetchBriefingWeather({ place: placeName, latitude, longitude }).catch(() => null);
    }
    const appointments = extras?.appointments ? await extras.appointments().catch(() => null) : null;
    const night = extras?.night ? await extras.night().catch(() => []) : [];
    const reply = composeBriefing({
      now,
      weather,
      appointments,
      pendingNotes: [],
      night,
      rainMmPerHour: window.rainMmPerHour ?? BRIEFING_RAIN_MM_PER_HOUR,
      gustKmh: window.gustKmh ?? BRIEFING_GUST_KMH,
      voice: input.voice,
    });
    await writeOffered(userData(), briefingDay(now));
    return reply.text;
  };
}

async function readOffered(root: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(join(root, 'quotidien', 'briefing-jour.json'), 'utf8')) as { day?: unknown };
    return typeof raw.day === 'string' ? raw.day : null;
  } catch {
    return null;
  }
}

async function writeOffered(root: string, day: string): Promise<void> {
  const dir = join(root, 'quotidien');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'briefing-jour.json');
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ day })}\n`, 'utf8');
  await rename(tmp, path);
}
