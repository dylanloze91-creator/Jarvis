import { describeError } from '../../search/shared.js';
import {
  MarketDataError,
  type MarketDataProvider,
  type MarketDataProviderDescriptor,
  type MarketDataQuery,
  type StockQuote,
} from '../types.js';

export const yahooFinanceDescriptor: MarketDataProviderDescriptor = {
  id: 'yahoo-finance',
  label: 'Yahoo Finance (sans clé, non officiel)',
  requiresApiKey: false,
};

interface YahooSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
}

interface YahooSearchResponse {
  quotes?: YahooSearchQuote[];
}

interface YahooChartMeta {
  symbol?: string;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  regularMarketChangePercent?: number;
  chartPreviousClose?: number;
  previousClose?: number;
}

interface YahooChartResponse {
  chart?: {
    result?: { meta: YahooChartMeta }[];
    error?: { description?: string } | null;
  };
}

/**
 * Utilise les points d'entrée non officiels de Yahoo Finance (recherche par
 * nom, puis cours via l'endpoint « chart »). Aucune clé, aucune inscription :
 * c'est ce qui permet au fournisseur d'être actif par défaut. Contrepartie
 * assumée : ces points d'entrée ne sont pas documentés publiquement, peuvent
 * changer sans préavis et sont parfois limités en débit. Voir Finnhub pour un
 * fournisseur avec une API officielle et documentée (clé gratuite requise).
 */
export class YahooFinanceMarketDataProvider implements MarketDataProvider {
  readonly id = yahooFinanceDescriptor.id;
  readonly label = yahooFinanceDescriptor.label;
  readonly requiresApiKey = false;

  async getQuote(query: MarketDataQuery): Promise<StockQuote> {
    const resolved = await this.resolveSymbol(query);
    return this.fetchQuote(resolved, query);
  }

  private async resolveSymbol(query: MarketDataQuery): Promise<{ symbol: string; name: string }> {
    const url = new URL('https://query2.finance.yahoo.com/v1/finance/search');
    url.searchParams.set('q', query.query);
    url.searchParams.set('quotesCount', '5');
    url.searchParams.set('newsCount', '0');

    const response = await safeFetch(url, query.signal, 'Recherche du symbole');
    const payload = (await response.json().catch(() => null)) as YahooSearchResponse | null;
    const candidates = (payload?.quotes ?? []).filter(
      (candidate): candidate is YahooSearchQuote & { symbol: string } =>
        typeof candidate.symbol === 'string' && candidate.symbol.length > 0,
    );

    const best =
      candidates.find((candidate) => candidate.quoteType === 'EQUITY') ??
      candidates.find(
        (candidate) => candidate.quoteType === 'ETF' || candidate.quoteType === 'INDEX',
      ) ??
      candidates[0];

    if (!best) {
      throw new MarketDataError(`Aucune valeur boursière trouvée pour « ${query.query} ».`);
    }

    return { symbol: best.symbol, name: best.longname ?? best.shortname ?? best.symbol };
  }

  private async fetchQuote(
    resolved: { symbol: string; name: string },
    query: MarketDataQuery,
  ): Promise<StockQuote> {
    const url = new URL(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(resolved.symbol)}`,
    );
    url.searchParams.set('range', '1d');
    url.searchParams.set('interval', '1d');

    const response = await safeFetch(url, query.signal, 'Cours de bourse');
    const payload = (await response.json().catch(() => null)) as YahooChartResponse | null;

    if (payload?.chart?.error) {
      throw new MarketDataError(
        payload.chart.error.description ?? `Symbole introuvable : ${resolved.symbol}`,
      );
    }

    const meta = payload?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') {
      throw new MarketDataError(
        `Cours indisponible pour « ${resolved.name} » (${resolved.symbol}).`,
      );
    }

    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice;
    const change = meta.regularMarketPrice - previousClose;
    const changePercent =
      typeof meta.regularMarketChangePercent === 'number'
        ? meta.regularMarketChangePercent
        : previousClose
          ? (change / previousClose) * 100
          : 0;

    return {
      query: query.query,
      symbol: meta.symbol ?? resolved.symbol,
      name: resolved.name,
      price: meta.regularMarketPrice,
      currency: meta.currency ?? 'USD',
      change,
      changePercent,
      exchange: meta.fullExchangeName ?? meta.exchangeName,
      asOf: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
      providerId: this.id,
    };
  }
}

async function safeFetch(
  url: URL,
  signal: AbortSignal | undefined,
  label: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; Jarvis/1.0)' },
    });
  } catch (error) {
    throw new MarketDataError(`${label} indisponible : ${describeError(error)}`);
  }
  if (response.status === 429) {
    throw new MarketDataError(
      `${label} a limité la fréquence des requêtes (429). Réessaie dans quelques instants.`,
      429,
    );
  }
  if (!response.ok) {
    throw new MarketDataError(
      `${label} a répondu avec une erreur (HTTP ${response.status}).`,
      response.status,
    );
  }
  return response;
}
