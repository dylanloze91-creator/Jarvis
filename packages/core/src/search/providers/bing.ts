import { clampLimit } from '../shared.js';
import { leadingSnippetDate } from '../dates.js';
import { decodeEntities, fetchSearchText, hostnameOf, htmlToText, isPublicResultUrl } from '../http.js';
import {
  SearchProviderError,
  type SearchFreshness,
  type SearchProvider,
  type SearchProviderDescriptor,
  type SearchQuery,
  type SearchResponse,
  type SearchResultItem,
} from '../types.js';

export const bingDescriptor: SearchProviderDescriptor = {
  id: 'bing',
  label: 'Bing (sans clé)',
  requiresApiKey: false,
};

export interface BingOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const FRESHNESS: Record<SearchFreshness, string> = { day: 'ez1', week: 'ez2', month: 'ez3' };

/**
 * Bing sans clé : page HTML publique. L'API Bing Search a fermé le
 * 11 août 2025 ; la page reste servie, mais une adresse jugée robotique peut
 * recevoir des résultats hors sujet avec un statut 200 — la chaîne de
 * recherche les écarte par pertinence.
 */
export class BingSearchProvider implements SearchProvider {
  readonly id = bingDescriptor.id;
  readonly label = bingDescriptor.label;
  readonly requiresApiKey = false;

  constructor(private readonly options: BingOptions = {}) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const text = query.query.trim();
    if (!text) throw new SearchProviderError('La recherche Bing nécessite une requête non vide.');
    const limit = clampLimit(query.limit, 5, 10);
    const url = new URL('https://www.bing.com/search');
    url.searchParams.set('q', text);
    url.searchParams.set('setlang', 'fr');
    url.searchParams.set('cc', 'FR');
    url.searchParams.set('count', String(Math.max(limit, 10)));
    if (query.freshness) url.searchParams.set('filters', `ex1:"${FRESHNESS[query.freshness]}"`);

    const response = await fetchSearchText(url.toString(), 'Bing', {
      signal: query.signal,
      fetchImpl: this.options.fetchImpl,
    });
    if (response.status === 429 || response.status === 503) {
      throw new SearchProviderError(`Bing limite temporairement les requêtes (HTTP ${response.status}).`, response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SearchProviderError(`Bing a répondu avec une erreur (HTTP ${response.status}).`, response.status);
    }
    if (/id="b_captcha|\/challenge\/verify|captcha_container/i.test(response.text.slice(0, 300_000))) {
      throw new SearchProviderError('Bing a demandé une vérification anti-robot.');
    }
    const results = parseBingHtml(response.text, limit, this.options.now?.() ?? new Date());
    if (results.length === 0) throw new SearchProviderError('Bing a renvoyé une page sans résultats.');
    return { providerId: this.id, results };
  }
}

/** `https://www.bing.com/ck/a?…&u=a1<base64url>` → URL de destination. */
export function unwrapBingHref(raw: string): string | null {
  const href = decodeEntities(raw.trim());
  try {
    const url = new URL(href, 'https://www.bing.com');
    if (/(^|\.)bing\.com$/i.test(url.hostname)) {
      const encoded = url.searchParams.get('u');
      if (!encoded) return null;
      const payload = encoded.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
      const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
      const decoded = decodeBase64(padded);
      return decoded && isPublicResultUrl(decoded) ? decoded : null;
    }
    return isPublicResultUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

function decodeBase64(value: string): string | null {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function parseBingHtml(html: string, limit: number, now: Date = new Date()): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<li class="b_algo"/i).slice(1);
  for (const raw of blocks) {
    if (results.length >= limit) break;
    const block = raw.split(/<li class="b_(?:algo|ans|ad)/i)[0] ?? raw;
    const heading = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!heading?.[1] || !heading[2]) continue;
    const url = unwrapBingHref(heading[1]);
    const title = htmlToText(heading[2]);
    if (!url || !title || seen.has(url)) continue;
    const caption =
      block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
      block.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const dated = leadingSnippetDate(caption ? htmlToText(caption[1] ?? '') : '', now);
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
