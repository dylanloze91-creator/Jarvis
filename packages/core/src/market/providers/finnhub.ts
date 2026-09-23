import { describeError } from '../../search/shared.js';
import {
  MarketDataError,
  type MarketDataProvider,
  type MarketDataProviderConfig,
  type MarketDataProviderDescriptor,
  type MarketDataQuery,
  type StockQuote,
} from '../types.js';

export const finnhubDescriptor: MarketDataProviderDescriptor = {
  id: 'finnhub',
  label: 'Finnhub (clé gratuite requise)',
  requiresApiKey: true,
};

interface FinnhubSearchResult {
  symbol: string;
  description: string;
  type?: string;
}

interface FinnhubSearchResponse {
  result?: FinnhubSearchResult[];
}

interface FinnhubQuote {
  c?: number;
  d?: number | null;
  dp?: number | null;
  t?: number;
}

interface FinnhubProfile {
  name?: string;
  currency?: string;
  exchange?: string;
}

/**
 * Fournisseur optionnel, à activer avec une clé gratuite (finnhub.io/register,
 * quota généreux sur le plan gratuit). Contrairement à Yahoo Finance, il
 * repose sur une API officielle et documentée, ce qui le rend plus fiable
 * dans la durée ; il reste désactivé par défaut car il exige une inscription.
 */
export class FinnhubMarketDataProvider implements MarketDataProvider {
  readonly id = finnhubDescriptor.id;
  readonly label = finnhubDescriptor.label;
  readonly requiresApiKey = true;
  private readonly apiKey: string;

  constructor(config: MarketDataProviderConfig) {
    this.apiKey = config.apiKey ?? '';
  }

  async getQuote(query: MarketDataQuery): Promise<StockQuote> {
    if (!this.apiKey) {
      throw new MarketDataError('Clé API manquante pour Finnhub.');
    }

    const resolved = await this.resolveSymbol(query);
    const quote = await this.fetchJson<FinnhubQuote>(
      'quote',
      { symbol: resolved.symbol },
      query.signal,
      'Cours de bourse',
    );

    if (!quote || typeof quote.c !== 'number' || quote.c === 0) {
      throw new MarketDataError(
        `Cours indisponible pour « ${resolved.name} » (${resolved.symbol}).`,
      );
    }

    const profile = await this.fetchJson<FinnhubProfile>(
      'stock/profile2',
      { symbol: resolved.symbol },
      query.signal,
      'Profil boursier',
    ).catch(() => null);

    return {
      query: query.query,
      symbol: resolved.symbol,
      name: profile?.name ?? resolved.name,
      price: quote.c,
      currency: profile?.currency ?? 'USD',
      change: quote.d ?? 0,
      changePercent: quote.dp ?? 0,
      exchange: profile?.exchange,
      asOf: quote.t ? new Date(quote.t * 1000).toISOString() : new Date().toISOString(),
      providerId: this.id,
    };
  }

  private async resolveSymbol(query: MarketDataQuery): Promise<{ symbol: string; name: string }> {
    const payload = await this.fetchJson<FinnhubSearchResponse>(
      'search',
      { q: query.query },
      query.signal,
      'Recherche du symbole',
    );
    const results = payload?.result ?? [];
    const best = results.find((candidate) => candidate.type === 'Common Stock') ?? results[0];

    if (!best) {
      throw new MarketDataError(`Aucune valeur boursière trouvée pour « ${query.query} ».`);
    }

    return { symbol: best.symbol, name: best.description };
  }

  private async fetchJson<T>(
    path: string,
    params: Record<string, string>,
    signal: AbortSignal | undefined,
    label: string,
  ): Promise<T> {
    const url = new URL(`https://finnhub.io/api/v1/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('token', this.apiKey);

    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      throw new MarketDataError(`${label} indisponible : ${describeError(error)}`);
    }

    if (response.status === 429) {
      throw new MarketDataError(`${label} a limité la fréquence des requêtes (429).`, 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw new MarketDataError('Clé API Finnhub invalide ou refusée.', response.status);
    }
    if (!response.ok) {
      throw new MarketDataError(
        `${label} a répondu avec une erreur (HTTP ${response.status}).`,
        response.status,
      );
    }

    const data = (await response.json().catch(() => null)) as T | null;
    if (data === null) {
      throw new MarketDataError(`${label} : réponse illisible.`);
    }
    return data;
  }
}
