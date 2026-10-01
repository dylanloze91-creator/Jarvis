import { clampLimit } from '../shared.js';
import { parseFeedDate } from '../dates.js';
import { fetchSearchText, hostnameOf, isPublicResultUrl } from '../http.js';
import {
  SearchProviderError,
  type SearchFreshness,
  type SearchProvider,
  type SearchProviderConfig,
  type SearchProviderDescriptor,
  type SearchQuery,
  type SearchResponse,
  type SearchResultItem,
} from '../types.js';

export const tavilyDescriptor: SearchProviderDescriptor = {
  id: 'tavily',
  label: 'Tavily (clé gratuite, sans carte)',
  requiresApiKey: true,
};

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string | null;
}

const TIME_RANGE: Record<SearchFreshness, string> = { day: 'day', week: 'week', month: 'month' };

/**
 * Fournisseur optionnel : 1 000 requêtes gratuites par mois, sans carte
 * bancaire (tavily.com). La clé part uniquement dans l'en-tête
 * `Authorization` ; aucun message d'erreur ne la contient.
 */
export class TavilySearchProvider implements SearchProvider {
  readonly id = tavilyDescriptor.id;
  readonly label = tavilyDescriptor.label;
  readonly requiresApiKey = true;
  private readonly apiKey: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(config: SearchProviderConfig, fetchImpl?: typeof fetch) {
    this.apiKey = config.apiKey?.trim() ?? '';
    this.fetchImpl = fetchImpl;
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    if (!this.apiKey) throw new SearchProviderError('Clé API manquante pour Tavily.');
    const limit = clampLimit(query.limit, 5, 10);
    const body: Record<string, unknown> = {
      query: query.query,
      max_results: limit,
      search_depth: 'basic',
      topic: query.freshness ? 'news' : 'general',
      include_answer: false,
      include_published_date: true,
    };
    if (query.freshness) body.time_range = TIME_RANGE[query.freshness];

    const response = await fetchSearchText('https://api.tavily.com/search', 'Tavily', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      signal: query.signal,
      fetchImpl: this.fetchImpl,
    });

    if (response.status === 401 || response.status === 403) {
      throw new SearchProviderError('Clé API Tavily invalide ou refusée.', response.status);
    }
    if (response.status === 429 || response.status === 432 || response.status === 433) {
      throw new SearchProviderError('Tavily : quota ou fréquence dépassés.', response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SearchProviderError(`Tavily a répondu avec une erreur (HTTP ${response.status}).`, response.status);
    }

    let payload: { results?: TavilyResult[] } | null = null;
    try {
      payload = JSON.parse(response.text) as { results?: TavilyResult[] };
    } catch {
      throw new SearchProviderError('Tavily a renvoyé une réponse illisible.');
    }
    const results: SearchResultItem[] = (payload?.results ?? [])
      .filter((hit) => hit.url && hit.title && isPublicResultUrl(hit.url))
      .slice(0, limit)
      .map((hit) => ({
        title: hit.title ?? '',
        url: hit.url ?? '',
        snippet: (hit.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
        source: hostnameOf(hit.url ?? ''),
        publishedAt: parseFeedDate(hit.published_date ?? undefined),
      }));
    return { providerId: this.id, results };
  }
}
