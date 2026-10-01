import { clampLimit } from '../shared.js';
import { leadingSnippetDate } from '../dates.js';
import { fetchSearchText, hostnameOf, htmlToText, decodeEntities, isPublicResultUrl } from '../http.js';
import {
  SearchProviderError,
  type SearchFreshness,
  type SearchProvider,
  type SearchProviderDescriptor,
  type SearchQuery,
  type SearchResponse,
  type SearchResultItem,
} from '../types.js';

export const duckDuckGoDescriptor: SearchProviderDescriptor = {
  id: 'duckduckgo',
  label: 'DuckDuckGo (sans clé)',
  requiresApiKey: false,
};

export interface DuckDuckGoOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const FRESHNESS: Record<SearchFreshness, string> = { day: 'd', week: 'w', month: 'm' };
/** Par point d'accès : quand DuckDuckGo bloque, il laisse parfois la requête pendre. */
const DDG_TIMEOUT_MS = 4_000;

/**
 * DuckDuckGo sans clé : page HTML publique (`html.duckduckgo.com`), puis la
 * version « lite » si la première refuse. DuckDuckGo répond HTTP 202 avec un
 * défi « anomaly » quand il juge les requêtes trop rapprochées : c'est une
 * erreur du fournisseur, pas « aucun résultat ».
 */
export class DuckDuckGoSearchProvider implements SearchProvider {
  readonly id = duckDuckGoDescriptor.id;
  readonly label = duckDuckGoDescriptor.label;
  readonly requiresApiKey = false;

  constructor(private readonly options: DuckDuckGoOptions = {}) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const text = query.query.trim();
    if (!text) throw new SearchProviderError('La recherche DuckDuckGo nécessite une requête non vide.');
    const limit = clampLimit(query.limit, 5, 10);
    const form = new URLSearchParams({ q: text, kl: 'fr-fr' });
    if (query.freshness) form.set('df', FRESHNESS[query.freshness]);
    const now = this.options.now?.() ?? new Date();

    let lastError: SearchProviderError | null = null;
    for (const endpoint of ['https://html.duckduckgo.com/html/', 'https://lite.duckduckgo.com/lite/']) {
      try {
        const response = await fetchSearchText(endpoint, 'DuckDuckGo', {
          method: 'POST',
          body: form.toString(),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            referer: new URL(endpoint).origin + '/',
          },
          signal: query.signal,
          fetchImpl: this.options.fetchImpl,
          timeoutMs: DDG_TIMEOUT_MS,
        });
        if (isDuckDuckGoChallenge(response.status, response.text)) {
          lastError = new SearchProviderError(
            'DuckDuckGo limite temporairement les requêtes (défi anti-robot).',
            response.status === 200 ? 202 : response.status,
          );
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          lastError = new SearchProviderError(
            `DuckDuckGo a répondu avec une erreur (HTTP ${response.status}).`,
            response.status,
          );
          continue;
        }
        const results = endpoint.includes('lite.')
          ? parseDuckDuckGoLite(response.text, limit, now)
          : parseDuckDuckGoHtml(response.text, limit, now);
        if (results.length > 0) return { providerId: this.id, results };
        lastError = new SearchProviderError('DuckDuckGo a renvoyé une page sans résultats.');
      } catch (error) {
        if (query.signal?.aborted) throw error;
        lastError =
          error instanceof SearchProviderError
            ? error
            : new SearchProviderError(`DuckDuckGo indisponible : ${String(error)}`);
      }
    }
    throw lastError ?? new SearchProviderError('DuckDuckGo indisponible.');
  }
}

export function isDuckDuckGoChallenge(status: number, html: string): boolean {
  if (status === 202) return true;
  const sample = html.slice(0, 200_000).toLowerCase();
  return (
    sample.includes('anomaly-modal') ||
    sample.includes('bots use duckduckgo') ||
    sample.includes('id="challenge-form"')
  );
}

/** `//duckduckgo.com/l/?uddg=<url>&rut=…` → URL de destination. */
export function unwrapDuckDuckGoHref(raw: string): string | null {
  const href = decodeEntities(raw.trim());
  try {
    const absolute = href.startsWith('//') ? `https:${href}` : href;
    const url = new URL(absolute, 'https://duckduckgo.com');
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname)) {
      const target = url.searchParams.get('uddg');
      if (!target) return null;
      if (url.searchParams.has('ad_domain') || /\/y\.js/.test(url.pathname)) return null;
      return isPublicResultUrl(target) ? target : null;
    }
    return isPublicResultUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

function isAdTarget(url: string): boolean {
  return /duckduckgo\.com\/y\.js|bing\.com\/aclick|doubleclick\.net/i.test(url);
}

export function parseDuckDuckGoHtml(html: string, limit: number, now: Date = new Date()): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    if (/result--ad\b|badge--ad/i.test(block.slice(0, 400))) continue;
    const anchor = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor?.[1] || !anchor[2]) continue;
    const url = unwrapDuckDuckGoHref(anchor[1]);
    const title = htmlToText(anchor[2]);
    if (!url || !title || isAdTarget(url) || seen.has(url)) continue;
    const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i);
    const dated = leadingSnippetDate(snippetMatch ? htmlToText(snippetMatch[1] ?? '') : '', now);
    const timestamp = block.match(/class="[^"]*result__timestamp[^"]*"[^>]*>([\s\S]*?)<\//i);
    const stamped = timestamp ? leadingSnippetDate(`${htmlToText(timestamp[1] ?? '')} ·`, now) : undefined;
    seen.add(url);
    results.push({
      title,
      url,
      snippet: dated.rest,
      source: hostnameOf(url),
      publishedAt: dated.publishedAt ?? stamped?.publishedAt,
    });
  }
  return results;
}

export function parseDuckDuckGoLite(html: string, limit: number, now: Date = new Date()): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  const linkPattern =
    /<a[^>]+href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=['"]result-link['"][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) && results.length < limit) {
    const href = match[1] ?? match[3] ?? '';
    const url = unwrapDuckDuckGoHref(href);
    const title = htmlToText(match[2] ?? match[4] ?? '');
    if (!url || !title || isAdTarget(url) || seen.has(url)) continue;
    const after = html.slice(linkPattern.lastIndex, linkPattern.lastIndex + 3000);
    const snippetMatch = after.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i);
    const dated = leadingSnippetDate(snippetMatch ? htmlToText(snippetMatch[1] ?? '') : '', now);
    seen.add(url);
    results.push({
      title,
      url,
      snippet: dated.rest,
      source: hostnameOf(url),
      publishedAt: dated.publishedAt,
    });
  }
  return results;
}
