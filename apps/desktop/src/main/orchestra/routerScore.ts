import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pickLatestRouterScore, type MeasuredBench, type RouterScoreLine } from '@jarvis/core';

const REPORT_NAME = /trieur-(?:banc|dernier-score).*\.json$/i;

async function reportFiles(place: string): Promise<string[]> {
  try {
    const info = await stat(place);
    if (info.isFile()) return REPORT_NAME.test(place) ? [place] : [];
    if (!info.isDirectory()) return [];
    const names = await readdir(place);
    return names.filter((name) => REPORT_NAME.test(name)).map((name) => join(place, name));
  } catch {
    return [];
  }
}

/** Dernier score du banc, s'il existe dans userData ou dans `rapports`. */
export async function readRouterScore(places: readonly string[]): Promise<RouterScoreLine | null> {
  const files = [...new Set((await Promise.all(places.map((place) => reportFiles(place)))).flat())];
  const reports: (MeasuredBench & { name?: string })[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as MeasuredBench;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.models)) continue;
      reports.push({ ...parsed, name: file });
    } catch {
      // Un rapport illisible ne bloque pas les autres.
    }
  }
  return pickLatestRouterScore(reports);
}
