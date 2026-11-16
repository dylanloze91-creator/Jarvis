/**
 * Revue de la semaine : regrouper, écarter un faux raté, phrase du dimanche.
 * La phrase n'est jamais dite à voix haute (`speak: false`).
 */
import { wordOverlap } from './text.js';
import {
  CARNET_FORMAT_VERSION,
  DEFAULT_REPETITION_OVERLAP,
  RATE_CATEGORY_LABELS,
  type FalseAlarmLedger,
  type RateCategory,
  type RateEntry,
  type RateKind,
} from './types.js';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const GROUP_LIMIT = 10;

export interface CarnetGroup {
  id: string;
  type: RateKind;
  rule: string;
  count: number;
  userText: string;
  replyStart: string;
  ids: string[];
  expected?: string;
  category?: RateCategory;
}

export function ratesThisWeek(entries: readonly RateEntry[], now: number): RateEntry[] {
  return entries.filter((entry) => {
    const at = Date.parse(entry.date);
    return Number.isFinite(at) && at <= now && now - at <= WEEK_MS;
  });
}

/** Même type et mots proches. Les groupes les plus nombreux d'abord. */
export function groupRates(
  entries: readonly RateEntry[],
  overlap = DEFAULT_REPETITION_OVERLAP,
): CarnetGroup[] {
  const groups: CarnetGroup[] = [];
  const ordered = [...entries].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  for (const entry of ordered) {
    let best: { group: CarnetGroup; score: number } | null = null;
    for (const group of groups) {
      if (group.type !== entry.type) continue;
      const score = wordOverlap(group.userText, entry.userText);
      if (score < overlap) continue;
      if (!best || score > best.score) best = { group, score };
    }
    if (best) {
      best.group.ids.push(entry.id);
      best.group.count += 1;
      best.group.rule = entry.rule;
      if (entry.expected) best.group.expected = entry.expected;
      if (entry.category) best.group.category = entry.category;
      continue;
    }
    groups.push({
      id: `${entry.type}:${entry.id}`,
      type: entry.type,
      rule: entry.rule,
      count: 1,
      userText: entry.userText,
      replyStart: entry.replyStart,
      ids: [entry.id],
      ...(entry.expected ? { expected: entry.expected } : {}),
      ...(entry.category ? { category: entry.category } : {}),
    });
  }
  return groups.sort((a, b) => b.count - a.count || a.userText.localeCompare(b.userText, 'fr'));
}

export function pageGroups(
  groups: readonly CarnetGroup[],
  showAll: boolean,
  limit = GROUP_LIMIT,
): { shown: CarnetGroup[]; rest: number } {
  if (showAll || groups.length <= limit) return { shown: [...groups], rest: 0 };
  return { shown: groups.slice(0, limit), rest: groups.length - limit };
}

export function emptyLedger(): FalseAlarmLedger {
  return { version: CARNET_FORMAT_VERSION, counts: {} };
}

/** Retire les entrées et compte la règle comme fausse alerte. */
export function dismissRates(
  entries: readonly RateEntry[],
  ids: readonly string[],
  ledger: FalseAlarmLedger,
): { entries: RateEntry[]; ledger: FalseAlarmLedger } {
  const drop = new Set(ids);
  const counts = { ...ledger.counts };
  for (const entry of entries) {
    if (!drop.has(entry.id)) continue;
    counts[entry.rule] = (counts[entry.rule] ?? 0) + 1;
  }
  return {
    entries: entries.filter((entry) => !drop.has(entry.id)),
    ledger: { version: CARNET_FORMAT_VERSION, counts },
  };
}

export function annotateRates(
  entries: readonly RateEntry[],
  ids: readonly string[],
  patch: { expected?: string; category?: RateCategory },
): RateEntry[] {
  const chosen = new Set(ids);
  return entries.map((entry) => {
    if (!chosen.has(entry.id)) return entry;
    return {
      ...entry,
      reviewed: true,
      ...(patch.expected !== undefined ? { expected: patch.expected } : {}),
      ...(patch.category ? { category: patch.category } : {}),
    };
  });
}

export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Phrase du dimanche, au premier passage de la journée.
 * `speak` est toujours faux : l'enceinte ne la dit pas.
 */
export function sundayNotice(
  now: Date,
  shownOn: string | null,
  count: number,
): { text: string; speak: false; day: string } | null {
  if (now.getDay() !== 0 || count <= 0) return null;
  const day = localDay(now);
  if (shownOn === day) return null;
  const word = count === 1 ? 'raté' : 'ratés';
  return {
    text: `Cette semaine, j'ai noté ${count} ${word}. Tu veux les voir ?`,
    speak: false,
    day,
  };
}

/** Texte à donner soi-même. Jarvis ne l'envoie nulle part. */
export function weekMarkdown(groups: readonly CarnetGroup[], now: Date): string {
  const lines = [
    `# Carnet des ratés — semaine du ${localDay(now)}`,
    '',
    'À donner toi-même si tu le veux. Jarvis ne l’envoie pas.',
    '',
  ];
  if (!groups.length) {
    lines.push('Aucun raté cette semaine.', '');
    return lines.join('\n');
  }
  for (const group of groups) {
    lines.push(`## ${group.count} · ${group.type}`, '');
    lines.push(`- Phrase : ${group.userText}`);
    if (group.replyStart) lines.push(`- Réponse : ${group.replyStart}`);
    lines.push(`- Règle : ${group.rule}`);
    if (group.category) lines.push(`- Catégorie : ${RATE_CATEGORY_LABELS[group.category]}`);
    if (group.expected) lines.push(`- Attendu : ${group.expected}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
