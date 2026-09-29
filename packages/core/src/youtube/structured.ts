/**
 * Lecture tolérante des réponses du modèle local.
 * Le condensé reste en prose : si le modèle renvoie le JSON d'une analyse
 * structurée, on en garde les phrases, pas les scores.
 */

export function parseVideoJson<T>(raw: string, fallback: T): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        // fall through
      }
    }
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1)) as T;
      } catch {
        // fall through
      }
    }
    return fallback;
  }
}

export function importanceScore(raw: string): number | null {
  const match = raw.match(/importance"?\s*:\s*(\d{1,3})/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function rankNotesByImportance(notes: { text: string; score: number | null }[]): string[] {
  if (notes.every((note) => note.score === null)) return notes.map((note) => note.text);
  return notes
    .map((note, index) => ({ ...note, index }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.index - b.index)
    .map((note) => note.text);
}

/** Retire la ligne de score pour qu'elle ne reste pas dans la réponse. */
export function stripImportanceLabels(text: string): string {
  return text
    .replace(/(^|\n)\s*Importance\s*:\s*\d{1,3}\s*(?=\n|$)/gi, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SKIPPED_JSON_KEYS = new Set(['importance', 'index', 'startSeconds', 'endSeconds', 'durationSeconds']);

/**
 * Si le modèle a répondu en JSON (analyse par segment), on récupère les textes.
 * Les scores numériques ne deviennent pas des phrases, pour ne pas autoriser
 * un chiffre qui n'a pas été dit.
 */
export function proseFromModelAnalysis(raw: string): string {
  const trimmed = raw.trim();
  if (!looksLikeJson(trimmed)) return raw;
  const parsed = parseVideoJson<unknown>(trimmed, null);
  if (parsed == null) return raw;
  const lines = collectStrings(parsed);
  if (lines.length === 0) return raw;
  return lines.join('\n');
}

function looksLikeJson(raw: string): boolean {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').trim();
  return cleaned.startsWith('{') || cleaned.startsWith('[');
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SKIPPED_JSON_KEYS.has(key)) continue;
      collectStrings(item, out);
    }
  }
  return out;
}
