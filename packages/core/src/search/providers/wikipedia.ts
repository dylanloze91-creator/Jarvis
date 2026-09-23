import { clampLimit, describeError, stripHtml } from '../shared.js';
import {
  SearchProviderError,
  type SearchProvider,
  type SearchProviderDescriptor,
  type SearchQuery,
  type SearchResponse,
  type SearchResultItem,
} from '../types.js';

export const wikipediaDescriptor: SearchProviderDescriptor = {
  id: 'wikipedia',
  label: 'Wikipédia (sans clé)',
  requiresApiKey: false,
};

interface WikipediaSearchHit {
  title: string;
  snippet: string;
}

interface WikipediaSearchResponse {
  query?: { search?: WikipediaSearchHit[] };
  error?: { info?: string };
}

/**
 * Fournisseur de recherche par défaut : ni clé, ni inscription. L'API de
 * recherche Wikimedia est stable, documentée et — contrairement à la plupart
 * des moteurs de recherche grand public — ne bloque pas les requêtes
 * automatisées, ce qui la rend utilisable immédiatement depuis un serveur.
 * Limite assumée : couverture strictement encyclopédique, pas d'actualité en
 * temps réel ni de résultats commerciaux ou locaux (ex. « meilleur
 * restaurant près de moi »). Voir Brave Search pour une couverture plus large.
 */
export class WikipediaSearchProvider implements SearchProvider {
  readonly id = wikipediaDescriptor.id;
  readonly label = wikipediaDescriptor.label;
  readonly requiresApiKey = false;

  async search(query: SearchQuery): Promise<SearchResponse> {
    const language = normalizeLanguage(query.language);
    const limit = clampLimit(query.limit, 5, 10);

    const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('srlimit', String(limit));
    url.searchParams.set('srsearch', query.query);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: query.signal,
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      throw new SearchProviderError(`Recherche Wikipédia indisponible : ${describeError(error)}`);
    }

    if (response.status === 429) {
      throw new SearchProviderError('Wikipédia a limité la fréquence des requêtes (429).', 429);
    }
    if (!response.ok) {
      throw new SearchProviderError(
        `Wikipédia a répondu avec une erreur (HTTP ${response.status}).`,
        response.status,
      );
    }

    const payload = (await response.json().catch(() => null)) as WikipediaSearchResponse | null;
    if (!payload) {
      throw new SearchProviderError('Réponse Wikipédia illisible.');
    }
    if (payload.error) {
      throw new SearchProviderError(payload.error.info ?? 'Erreur Wikipédia inconnue.');
    }

    const hits = payload.query?.search ?? [];
    const results: SearchResultItem[] = hits.map((hit) => ({
      title: hit.title,
      url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      snippet: stripHtml(hit.snippet),
      source: `${language}.wikipedia.org`,
    }));

    return {
      providerId: this.id,
      results,
      answer: results[0]?.snippet,
    };
  }
}

function normalizeLanguage(language: string | undefined): string {
  const code = (language ?? 'fr').toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(code) ? code : 'fr';
}
