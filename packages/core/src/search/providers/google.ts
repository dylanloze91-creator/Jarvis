import { clampLimit, describeError, stripHtml } from '../shared.js';
import {
  SearchProviderError,
  type SearchProvider,
  type SearchProviderDescriptor,
  type SearchQuery,
  type SearchResponse,
  type SearchResultItem,
} from '../types.js';

const GOOGLE_TIMEOUT_MS = 8_000;
const GOOGLE_MAX_RETRIES = 2;
const GOOGLE_RETRY_DELAY_MS = 500;

export const googleDescriptor: SearchProviderDescriptor = {
  id: 'google',
  label: 'Google (sans clé API)',
  requiresApiKey: false,
};

/**
 * Recherche Google sans API : page HTML publique, extraits organiques.
 * Fragile (HTML et anti-robot peuvent changer) mais gratuit. Les requêtes
 * sont bornées, annulables, et retentées seulement sur une erreur transitoire.
 */
export class GoogleSearchProvider implements SearchProvider {
  readonly id = googleDescriptor.id;
  readonly label = googleDescriptor.label;
  readonly requiresApiKey = false;

  async search(query: SearchQuery): Promise<SearchResponse> {
    const normalizedQuery = query.query.trim();
    if (!normalizedQuery) {
      throw new SearchProviderError('La recherche Google nécessite une requête non vide.');
    }

    const limit = clampLimit(query.limit, 5, 8);
    const language = normalizeLanguage(query.language);
    const url = new URL('https://www.google.com/search');
    url.searchParams.set('q', normalizedQuery);
    url.searchParams.set('num', String(limit));
    url.searchParams.set('hl', language);
    url.searchParams.set('safe', 'active');
    // Vue HTML simple : moins de dépendance au rendu JavaScript de Google.
    url.searchParams.set('udm', '14');

    let response: Response;
    let html: string;
    try {
      const result = await fetchGoogle(url, query.signal);
      response = result.response;
      html = result.html;
    } catch (error) {
      if (isAbortError(error) && query.signal?.aborted) throw error;
      throw new SearchProviderError(`Google indisponible : ${describeError(error)}`);
    }

    if (response.status === 429 || response.status === 503) {
      throw new SearchProviderError(
        `Google limite temporairement les requêtes (HTTP ${response.status}).`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new SearchProviderError(
        `Google a répondu avec une erreur (HTTP ${response.status}).`,
        response.status,
      );
    }

    if (isGoogleBotChallenge(html)) {
      throw new SearchProviderError('Google a demandé une vérification anti-robot.');
    }

    const results = parseGoogleResults(html, limit);
    if (results.length === 0) {
      throw new SearchProviderError('Google a renvoyé une page sans résultats exploitables.');
    }

    return { providerId: this.id, results };
  }
}

async function fetchGoogle(
  url: URL,
  parentSignal?: AbortSignal,
): Promise<{ response: Response; html: string }> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= GOOGLE_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted)
      throw parentSignal.reason ?? new DOMException('Aborted', 'AbortError');
    parentSignal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Timeout', 'TimeoutError')),
      GOOGLE_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
          'cache-control': 'no-cache',
        },
      });

      if (isRetryableStatus(response.status) && attempt < GOOGLE_MAX_RETRIES) {
        await response.body?.cancel().catch(() => undefined);
        await delay(retryDelay(response, attempt), parentSignal);
        continue;
      }

      const html = response.ok
        ? await readTextWithLimit(response, 3_000_000, controller.signal)
        : '';
      return { response, html };
    } catch (error) {
      lastError = error;
      if (isAbortError(error) && parentSignal?.aborted) throw error;
      if (!isRetryableError(error) || attempt >= GOOGLE_MAX_RETRIES) throw error;
      await delay(GOOGLE_RETRY_DELAY_MS * 2 ** attempt, parentSignal);
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError ?? new Error('Google request failed.');
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function isRetryableError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && /network|fetch|timeout/i.test(error.message))
  );
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 10) return seconds * 1000;
  }
  return GOOGLE_RETRY_DELAY_MS * 2 ** attempt;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readTextWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      const remaining = maxBytes - (received - value.byteLength);
      text += decoder.decode(remaining > 0 ? value.slice(0, remaining) : new Uint8Array(), {
        stream: remaining > 0 && received < maxBytes,
      });
      if (received >= maxBytes) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseGoogleResults(html: string, limit: number): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();

  // Google change régulièrement son balisage. On cherche donc le couple
  // lien + h3 plutôt qu'une classe CSS précise.
  const blockPattern =
    /<a\s[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) && results.length < limit) {
    const url = normalizeGoogleHref(decodeHtmlEntities(match[1] ?? ''));
    const title = cleanText(match[2] ?? '');
    if (!url || !title || seen.has(url) || !isPublicHttpUrl(url)) continue;

    seen.add(url);
    const context = html.slice(
      Math.max(0, blockPattern.lastIndex - 200),
      blockPattern.lastIndex + 1800,
    );
    const snippetMatch = context.match(
      /<(?:div|span)[^>]*(?:class|data-ved)=["'][^>]*(?:VwiC3b|yXK7lf)[^>]*>[\s\S]*?<\/(?:div|span)>/i,
    );
    const snippet = snippetMatch ? cleanText(snippetMatch[0]) : '';

    results.push({
      title,
      url,
      snippet,
      source: safeHostname(url),
    });
  }

  return results;
}

function normalizeGoogleHref(raw: string): string | null {
  try {
    if (raw.startsWith('/url?')) {
      const parsed = new URL(`https://www.google.com${raw}`);
      return parsed.searchParams.get('q') || parsed.searchParams.get('url');
    }
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    return null;
  } catch {
    return null;
  }
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !/(^|\.)google\.[a-z.]+$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function safeHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function cleanText(value: string): string {
  return stripHtml(decodeHtmlEntities(value)).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const parsed = code[0]?.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff
        ? String.fromCodePoint(parsed)
        : '';
    });
}

function isGoogleBotChallenge(html: string): boolean {
  const sample = html.slice(0, 500_000).toLowerCase();
  return (
    sample.includes('our systems have detected unusual traffic') ||
    sample.includes('unusual traffic from your computer network') ||
    sample.includes('/sorry/') ||
    sample.includes('not a robot') ||
    sample.includes('captcha challenge') ||
    sample.includes('verify you are human')
  );
}

function normalizeLanguage(language: string | undefined): string {
  const code = (language ?? 'fr').toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(code) ? code : 'fr';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
