import { afterEach, describe, expect, it, vi } from 'vitest';
import { YahooFinanceMarketDataProvider } from './yahooFinance.js';
import { MarketDataError } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const searchPayload = {
  quotes: [{ symbol: 'NVDA', longname: 'NVIDIA Corporation', quoteType: 'EQUITY' }],
};

const chartPayload = {
  chart: {
    result: [
      {
        meta: {
          symbol: 'NVDA',
          currency: 'USD',
          fullExchangeName: 'NasdaqGS',
          regularMarketPrice: 225.18,
          regularMarketChangePercent: -1.612,
          chartPreviousClose: 228.87,
          regularMarketTime: 1_700_000_000,
        },
      },
    ],
  },
};

describe('YahooFinanceMarketDataProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('résout un nom en langage naturel puis retourne la cotation', async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = input.toString();
      if (url.includes('/v1/finance/search')) return jsonResponse(searchPayload);
      if (url.includes('/v8/finance/chart/')) return jsonResponse(chartPayload);
      throw new Error(`URL inattendue : ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new YahooFinanceMarketDataProvider();
    const quote = await provider.getQuote({ query: 'nvidia' });

    expect(quote).toMatchObject({
      query: 'nvidia',
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      price: 225.18,
      currency: 'USD',
      changePercent: -1.612,
      exchange: 'NasdaqGS',
      providerId: 'yahoo-finance',
    });
    expect(quote.asOf).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('échoue proprement quand le nom ne correspond à aucune valeur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ quotes: [] })),
    );

    const provider = new YahooFinanceMarketDataProvider();
    await expect(provider.getQuote({ query: 'zzzzzzz-inexistant' })).rejects.toThrow(
      MarketDataError,
    );
  });

  it('signale une limitation de débit (429) sans planter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 })),
    );

    const provider = new YahooFinanceMarketDataProvider();
    await expect(provider.getQuote({ query: 'nvidia' })).rejects.toThrow(/429/);
  });

  it('signale une panne réseau sans planter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );

    const provider = new YahooFinanceMarketDataProvider();
    await expect(provider.getQuote({ query: 'nvidia' })).rejects.toThrow(/indisponible/);
  });
});
