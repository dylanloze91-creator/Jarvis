import { describeError } from './shared.js';
import { SearchProviderError } from './types.js';

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const SEARCH_TIMEOUT_MS = 8_000;

export interface SearchHttpOptions {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}

export interface SearchHttpResponse {
  status: number;
  text: string;
  headers: Headers;
}

/**
 * GET/POST borné pour les fournisseurs de recherche : délai, annulation
 * parente, taille lue plafonnée. Une erreur réseau devient une
 * `SearchProviderError` lisible ; l'URL n'y figure pas (elle peut contenir la
 * requête de l'utilisateur, et les clés passent par les en-têtes).
 */
export async function fetchSearchText(
  url: string,
  label: string,
  options: SearchHttpOptions = {},
): Promise<SearchHttpResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const parent = options.signal;
  if (parent?.aborted) throw parent.reason ?? new DOMException('Aborted', 'AbortError');
  const onAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('Timeout', 'TimeoutError')),
    options.timeoutMs ?? SEARCH_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(url, {
      method: options.method ?? 'GET',
      body: options.body,
      signal: controller.signal,
      headers: {
        'user-agent': BROWSER_USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
        ...options.headers,
      },
    });
    const text = await readLimited(response, options.maxBytes ?? 2_000_000);
    return { status: response.status, text, headers: response.headers };
  } catch (error) {
    if (parent?.aborted) throw parent.reason ?? error;
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new SearchProviderError(
      timedOut ? `${label} n'a pas répondu à temps.` : `${label} indisponible : ${describeError(error)}`,
    );
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onAbort);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (received >= maxBytes) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

export function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const parsed = code[0]?.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 0x10ffff
        ? String.fromCodePoint(parsed)
        : '';
    })
    .replace(/&amp;/g, '&');
}

/** Texte lisible d'un fragment HTML : balises retirées, entités décodées, espaces normalisés. */
export function htmlToText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return undefined;
  }
}

export function isPublicResultUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
