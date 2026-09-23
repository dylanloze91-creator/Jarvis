/** Petits utilitaires partagés par les fournisseurs de recherche. */

export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (!limit || limit < 1) return fallback;
  return Math.min(Math.trunc(limit), max);
}

export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
