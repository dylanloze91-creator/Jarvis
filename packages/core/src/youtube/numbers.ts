/** Entier (milliers groupés par une espace : « 7 200 »), décimale et « % » éventuels. */
const NUMBER_PATTERN = /(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d+)?[ \u00a0\u202f]*%?/g;

/** Nombres normalisés (espaces de milliers retirés, virgule décimale unifiée, % collé). */
export function numbersIn(text: string): string[] {
  const found = new Set<string>();
  const source = text.replace(
    /\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:→|->)\s*\d{1,2}:\d{2}(?::\d{2})?)?\]|\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
    ' ',
  );
  for (const match of source.matchAll(NUMBER_PATTERN)) {
    const normalized = normalizeNumberToken(match[0] ?? '');
    if (normalized) found.add(normalized);
  }
  return [...found];
}

/**
 * Retire les phrases dont un chiffre n'apparaît pas dans la source.
 * Une phrase sans chiffre est conservée. Les retours à la ligne (paragraphe,
 * puis liste de points) sont conservés.
 */
export function dropSentencesWithInventedNumbers(summary: string, source: string): string {
  const allowed = new Set(numbersIn(source));
  let total = 0;
  let kept = 0;
  const lines: string[] = [];
  for (const line of summary.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }
    const sentences = trimmed
      .split(/(?<=[.!?…])\s+/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const valid = sentences.filter((sentence) =>
      numbersIn(sentence).every((number) => allowed.has(number)),
    );
    total += sentences.length;
    kept += valid.length;
    if (valid.length > 0) lines.push(valid.join(' '));
  }
  if (total === 0) return '';
  if (kept === 0) {
    return "Je n'ai pas repris le condensé : il contenait des chiffres absents de ce qui a été dit.";
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeNumberToken(raw: string): string | null {
  let token = raw.trim().replace(/\s+/g, '');
  if (!/\d/.test(token)) return null;
  const percent = token.endsWith('%');
  if (percent) token = token.slice(0, -1);
  token = foldDecimal(token);
  if (!/^\d+(\.\d+)?$/.test(token)) return null;
  return percent ? `${token}%` : token;
}

function foldDecimal(token: string): string {
  if (token.includes(',') && token.includes('.')) {
    if (token.lastIndexOf(',') > token.lastIndexOf('.')) {
      return token.replace(/\./g, '').replace(',', '.');
    }
    return token.replace(/,/g, '');
  }
  if (token.includes(',')) {
    const parts = token.split(',');
    if (parts.length === 2 && (parts[1]?.length ?? 0) > 0 && (parts[1]?.length ?? 0) <= 2) {
      return `${parts[0]}.${parts[1]}`;
    }
    return token.replace(/,/g, '');
  }
  return token;
}
