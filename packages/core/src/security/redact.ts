/**
 * Masque les secrets avant tout journal. Le texte renvoyé au modèle et le
 * détail technique du développeur passent par ici : une clé, un jeton ou un
 * en-tête Authorization ne doit jamais rester en clair dans un log.
 */

const SECRET_KEY =
  /^(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|authorization|auth|token|siteblocktoken|site[_-]?block[_-]?token|spotifytoken|bearer|google[_-]?client[_-]?secret|code[_-]?verifier)$/i;

/** Noms préfixés de settings.json : `searchApiKey` (Tavily, Brave), `marketDataApiKey` (Finnhub)… */
const SECRET_KEY_SUFFIX = /(api[_-]?key|client[_-]?secret)$/i;

const INLINE_PATTERNS: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, replace: '$1[REDACTED]' },
  { pattern: /\b(sk-[A-Za-z0-9]{8,})/g, replace: '[REDACTED]' },
  { pattern: /\b(sk-ant-[A-Za-z0-9_-]{8,})/g, replace: '[REDACTED]' },
  { pattern: /\b(AIza[0-9A-Za-z_-]{10,})/g, replace: '[REDACTED]' },
  { pattern: /\b(ghp_[A-Za-z0-9]{8,})/g, replace: '[REDACTED]' },
  { pattern: /\b(xox[baprs]-[A-Za-z0-9-]{8,})/g, replace: '[REDACTED]' },
  { pattern: /\bya29\.[A-Za-z0-9._~+/-]{8,}/g, replace: '[REDACTED]' },
  { pattern: /(^|[^\w/])1\/\/[A-Za-z0-9._~+-]{16,}/g, replace: '$1[REDACTED]' },
  { pattern: /\bGOCSPX-[A-Za-z0-9_-]{8,}/g, replace: '[REDACTED]' },
  { pattern: /(^|[^\w/])4\/0[A-Za-z0-9._~+-]{16,}/g, replace: '$1[REDACTED]' },
  { pattern: /\btvly-[A-Za-z0-9_-]{8,}/g, replace: '[REDACTED]' },
  {
    // Préfixe facultatif (`searchApiKey`, `marketDataApiKey`, `x-api-key`), borné à 40 caractères : le texte lu reste parcouru en temps linéaire.
    pattern:
      /\b((?:[a-z][a-z0-9_-]{0,40}?)?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|site[_-]?block[_-]?token|authorization|id[_-]?token))(\s*["']?\s*[:=]\s*["']?)([^\s"',}]+)(["']?)/gi,
    replace: '$1$2[REDACTED]$4',
  },
  {
    pattern: /([?&](?:access_token|refresh_token|code|client_secret|api_key|token|code_verifier)=)[^&\s]+/gi,
    replace: '$1[REDACTED]',
  },
];

export function redactSecrets(input: string): string {
  let text = input;
  for (const rule of INLINE_PATTERNS) {
    text = text.replace(rule.pattern, rule.replace);
  }
  return text;
}

export function redactValue(value: unknown): unknown {
  return walk(value, new WeakSet());
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[REDACTED_CYCLE]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || SECRET_KEY_SUFFIX.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = walk(child, seen);
  }
  return out;
}
