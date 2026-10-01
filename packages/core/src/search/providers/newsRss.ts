import { clampLimit } from '../shared.js';
import { parseFeedDate } from '../dates.js';
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

export const googleNewsDescriptor: SearchProviderDescriptor = {
  id: 'google-news',
  label: 'Google Actualités (RSS, sans clé)',
  requiresApiKey: false,
};

export const bingNewsDescriptor: SearchProviderDescriptor = {
  id: 'bing-news',
  label: 'Bing Actualités (RSS, sans clé)',
  requiresApiKey: false,
};

/** Requête vide ou « * » : la une de Google Actualités France. */
export const NEWS_HEADLINES_QUERY = '*';

export interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  source?: string;
  sourceUrl?: string;
}

interface NewsOptions {
  fetchImpl?: typeof fetch;
}

const GOOGLE_WHEN: Record<SearchFreshness, string> = { day: '1d', week: '7d', month: '30d' };
const BING_INTERVAL: Record<SearchFreshness, string> = { day: '7', week: '8', month: '9' };

export function parseRssItems(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body = match[1] ?? '';
    const field = (name: string): string | undefined => {
      const found = body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
      return found?.[1] !== undefined ? decodeEntities(found[1]).trim() : undefined;
    };
    const sourceTag = body.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const sourceUrl = sourceTag?.[1]?.match(/url=["']([^"']+)["']/i)?.[1];
    items.push({
      title: htmlToText(field('title') ?? ''),
      link: (field('link') ?? '').trim(),
      description: htmlToText(field('description') ?? ''),
      pubDate: field('pubDate'),
      source: sourceTag?.[2] ? htmlToText(sourceTag[2]) : field('News:Source'),
      sourceUrl: sourceUrl ? decodeEntities(sourceUrl) : undefined,
    });
  }
  return items.filter((item) => item.title && item.link);
}

/**
 * Google Actualités, flux RSS public : le classement Google pour l'actualité,
 * daté, sans clé ni compte. Les liens passent par news.google.com (qui
 * redirige vers l'article dans le navigateur) ; le domaine du média vient de
 * `<source url>`. Fraîcheur : opérateur `when:` dans la requête.
 */
export class GoogleNewsRssProvider implements SearchProvider {
  readonly id = googleNewsDescriptor.id;
  readonly label = googleNewsDescriptor.label;
  readonly requiresApiKey = false;

  constructor(private readonly options: NewsOptions = {}) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const text = query.query.trim();
    const limit = clampLimit(query.limit, 6, 12);
    const headlines = !text || text === NEWS_HEADLINES_QUERY;
    const url = headlines
      ? new URL('https://news.google.com/rss')
      : new URL('https://news.google.com/rss/search');
    if (!headlines) {
      const when = query.freshness ? ` when:${GOOGLE_WHEN[query.freshness]}` : '';
      url.searchParams.set('q', `${text}${when}`);
    }
    url.searchParams.set('hl', 'fr');
    url.searchParams.set('gl', 'FR');
    url.searchParams.set('ceid', 'FR:fr');

    const response = await fetchSearchText(url.toString(), 'Google Actualités', {
      signal: query.signal,
      fetchImpl: this.options.fetchImpl,
      headers: { accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.5' },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SearchProviderError(
        `Google Actualités a répondu avec une erreur (HTTP ${response.status}).`,
        response.status,
      );
    }
    const results = parseRssItems(response.text)
      .slice(0, limit * 2)
      .map((item) => googleNewsResult(item))
      .filter((item): item is SearchResultItem => item !== null)
      .slice(0, limit);
    if (results.length === 0) throw new SearchProviderError('Google Actualités : aucun article.');
    return { providerId: this.id, results };
  }
}

function googleNewsResult(item: FeedItem): SearchResultItem | null {
  if (!isPublicResultUrl(item.link)) return null;
  const publisher = item.source?.trim() || undefined;
  const title =
    publisher && item.title.endsWith(` - ${publisher}`)
      ? item.title.slice(0, -(` - ${publisher}`.length)).trim()
      : item.title;
  const description = item.description.replace(title, '').replace(publisher ?? '', '').trim();
  return {
    title,
    url: item.link,
    snippet: description,
    source: (item.sourceUrl && hostnameOf(item.sourceUrl)) || publisher || hostnameOf(item.link),
    publisher,
    publishedAt: parseFeedDate(item.pubDate),
  };
}

/**
 * Bing Actualités, flux RSS public : articles datés, lien réel de l'article
 * dans le paramètre `url` de `apiclick.aspx`.
 */
export class BingNewsRssProvider implements SearchProvider {
  readonly id = bingNewsDescriptor.id;
  readonly label = bingNewsDescriptor.label;
  readonly requiresApiKey = false;

  constructor(private readonly options: NewsOptions = {}) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const text = query.query.trim();
    if (!text || text === NEWS_HEADLINES_QUERY) {
      throw new SearchProviderError('Bing Actualités nécessite une requête.');
    }
    const limit = clampLimit(query.limit, 6, 12);
    const url = new URL('https://www.bing.com/news/search');
    url.searchParams.set('q', text);
    url.searchParams.set('format', 'rss');
    url.searchParams.set('setlang', 'fr');
    url.searchParams.set('cc', 'FR');
    if (query.freshness) url.searchParams.set('qft', `interval="${BING_INTERVAL[query.freshness]}"`);

    const response = await fetchSearchText(url.toString(), 'Bing Actualités', {
      signal: query.signal,
      fetchImpl: this.options.fetchImpl,
      headers: { accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.5' },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SearchProviderError(
        `Bing Actualités a répondu avec une erreur (HTTP ${response.status}).`,
        response.status,
      );
    }
    const results = parseRssItems(response.text)
      .map((item) => {
        const target = unwrapBingNewsLink(item.link);
        if (!target) return null;
        return {
          title: item.title,
          url: target,
          snippet: item.description,
          source: hostnameOf(target),
          publisher: item.source || undefined,
          publishedAt: parseFeedDate(item.pubDate),
        } satisfies SearchResultItem;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, limit);
    if (results.length === 0) throw new SearchProviderError('Bing Actualités : aucun article.');
    return { providerId: this.id, results };
  }
}

export function unwrapBingNewsLink(raw: string): string | null {
  try {
    const url = new URL(decodeEntities(raw));
    if (/(^|\.)bing\.com$/i.test(url.hostname)) {
      const target = url.searchParams.get('url');
      return target && isPublicResultUrl(target) ? target : null;
    }
    return isPublicResultUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}
