import { clampLimit, describeError, safeHostname, stripHtml } from '../shared.js';
import {
  SearchProviderError,
  type SearchProvider,
  type SearchProviderConfig,
  type SearchProviderDescriptor,
  type SearchQuery,
  type SearchResponse,
  type SearchResultItem,
} from '../types.js';

export const braveDescriptor: SearchProviderDescriptor = {
  id: 'brave',
  label: 'Brave Search (clé requise)',
  requiresApiKey: true,
};

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

/**
 * Fournisseur optionnel, à activer avec une clé (offre gratuite disponible
 * sur brave.com/search/api). Couvre le web ouvert — actualité, avis, résultats
 * locaux — bien plus largement que Wikipédia ; à privilégier dès qu'une clé
 * est disponible.
 */
export class BraveSearchProvider implements SearchProvider {
  readonly id = braveDescriptor.id;
  readonly label = braveDescriptor.label;
  readonly requiresApiKey = true;
  private readonly apiKey: string;

  constructor(config: SearchProviderConfig) {
    this.apiKey = config.apiKey ?? '';
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new SearchProviderError('Clé API manquante pour Brave Search.');
    }

    const limit = clampLimit(query.limit, 5, 10);
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query.query);
    url.searchParams.set('count', String(limit));
    if (query.language) url.searchParams.set('search_lang', query.language);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: query.signal,
        headers: { accept: 'application/json', 'x-subscription-token': this.apiKey },
      });
    } catch (error) {
      throw new SearchProviderError(`Brave Search indisponible : ${describeError(error)}`);
    }

    if (response.status === 429) {
      throw new SearchProviderError('Brave Search a limité la fréquence des requêtes (429).', 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw new SearchProviderError('Clé API Brave Search invalide ou refusée.', response.status);
    }
    if (!response.ok) {
      throw new SearchProviderError(
        `Brave Search a répondu avec une erreur (HTTP ${response.status}).`,
        response.status,
      );
    }

    const payload = (await response.json().catch(() => null)) as BraveSearchResponse | null;
    const hits = payload?.web?.results ?? [];

    const results: SearchResultItem[] = hits.slice(0, limit).map((hit) => ({
      title: hit.title,
      url: hit.url,
      snippet: stripHtml(hit.description ?? ''),
      source: safeHostname(hit.url),
    }));

    return { providerId: this.id, results };
  }
}
