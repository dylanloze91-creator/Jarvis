/** Un résultat individuel retourné par un fournisseur de recherche. */
export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  /** Domaine d'origine, affiché comme source auprès de l'utilisateur. */
  source?: string;
}

export interface SearchQuery {
  query: string;
  /** Nombre maximal de résultats souhaité (par défaut selon le fournisseur). */
  limit?: number;
  /** Langue préférée, code ISO 639-1 (ex. « fr »). */
  language?: string;
  signal?: AbortSignal;
}

export interface SearchResponse {
  providerId: string;
  results: SearchResultItem[];
  /** Réponse synthétique quand le fournisseur en propose une (ex. extrait). */
  answer?: string;
}

export interface SearchProviderDescriptor {
  id: string;
  label: string;
  requiresApiKey: boolean;
}

/**
 * Contrat que tout fournisseur de recherche Internet doit respecter. Les
 * outils (`web_search`) ne connaissent que cette interface : changer de
 * fournisseur revient à écrire une implémentation et à l'enregistrer dans le
 * registre, sans toucher à l'outil ni à l'agent.
 */
export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresApiKey: boolean;
  search(query: SearchQuery): Promise<SearchResponse>;
}

export interface SearchProviderConfig {
  provider: string;
  apiKey?: string;
}

export type SearchProviderFactory = (config: SearchProviderConfig) => SearchProvider;

export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SearchProviderError';
  }
}
