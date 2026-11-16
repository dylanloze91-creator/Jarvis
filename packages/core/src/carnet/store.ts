/**
 * Fichier `rates.jsonl` : une ligne par raté, secrets masqués, 5 000 lignes au plus.
 * Le fichier lui-même n'est jamais dans le dépôt. Ici, seulement la forme.
 */
import { randomId } from '../types.js';
import { redactSecrets } from '../security/redact.js';
import {
  CARNET_FORMAT_VERSION,
  RATES_CAP,
  REPLY_START_MAX,
  type CarnetEdition,
  type CarnetPlace,
  type RateDetection,
  type RateEntry,
} from './types.js';

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function replyStartOf(text: string): string {
  return redactSecrets(text).slice(0, REPLY_START_MAX);
}

export function entryFromDetection(input: {
  id?: string;
  at: number;
  edition: CarnetEdition;
  place: CarnetPlace;
  conversationId: string;
  detection: RateDetection;
}): RateEntry {
  return {
    version: CARNET_FORMAT_VERSION,
    id: input.id ?? randomId(),
    date: new Date(input.at).toISOString(),
    edition: input.edition,
    source: input.place,
    type: input.detection.type,
    rule: input.detection.rule,
    userText: redactSecrets(input.detection.userText),
    replyStart: replyStartOf(input.detection.replyText),
    team: input.detection.team,
    model: input.detection.model,
    how: input.detection.how,
    tools: input.detection.tools.map((tool) => ({
      name: tool.name,
      result: redactSecrets(oneLine(tool.line || tool.outcome || tool.status)).slice(
        0,
        REPLY_START_MAX,
      ),
    })),
    durations: input.detection.durations,
    conversationId: input.conversationId,
    reviewed: false,
  };
}

/** Les plus anciennes déjà revues partent en premier. Ensuite, les plus anciennes tout court. */
export function trimRates(entries: readonly RateEntry[], cap = RATES_CAP): RateEntry[] {
  if (entries.length <= cap) return [...entries];
  let drop = entries.length - cap;
  const gone = new Set<number>();
  for (let i = 0; i < entries.length && drop > 0; i += 1) {
    if (!entries[i]?.reviewed) continue;
    gone.add(i);
    drop -= 1;
  }
  for (let i = 0; i < entries.length && drop > 0; i += 1) {
    if (gone.has(i)) continue;
    gone.add(i);
    drop -= 1;
  }
  return entries.filter((_, index) => !gone.has(index));
}

export function appendRate(
  entries: readonly RateEntry[],
  entry: RateEntry,
  cap = RATES_CAP,
): RateEntry[] {
  return trimRates([...entries, entry], cap);
}

export function parseRates(text: string): RateEntry[] {
  const entries: RateEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as RateEntry;
      if (!value || value.version !== CARNET_FORMAT_VERSION || typeof value.id !== 'string')
        continue;
      entries.push(value);
    } catch {
      // Ligne abîmée : on la saute, le reste du carnet reste lisible.
    }
  }
  return entries;
}

export function serializeRates(entries: readonly RateEntry[]): string {
  if (!entries.length) return '';
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}
