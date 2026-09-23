/** Résultat de l'extraction de texte lisible depuis une page HTML. */
export interface ReadablePage {
  title?: string;
  text: string;
  truncated: boolean;
}

const REMOVED_BLOCKS = /<(script|style|noscript|svg|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi;
const NUMERIC_ENTITY = /&#(\d+);/g;
const HEX_ENTITY = /&#x([0-9a-f]+);/gi;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  ccedil: 'ç',
  ocirc: 'ô',
  ugrave: 'ù',
  hellip: '…',
};

/**
 * Convertit une page HTML brute en texte lisible : retire scripts, styles et
 * balises, décode les entités courantes, puis tronque au-delà de `maxLength`
 * pour ne jamais renvoyer une page entière au modèle.
 */
export function extractReadableText(html: string, maxLength = 6000): ReadablePage {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const withoutBlocks = html.replace(REMOVED_BLOCKS, ' ');
  const withNewlines = withoutBlocks
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const decoded = decodeEntities(withNewlines);
  const lines = decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);

  const text = lines.join('\n');
  const truncated = text.length > maxLength;

  return {
    title: titleMatch?.[1] ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : undefined,
    text: truncated ? `${text.slice(0, maxLength).trimEnd()}…` : text,
    truncated,
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(NUMERIC_ENTITY, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(HEX_ENTITY, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}
