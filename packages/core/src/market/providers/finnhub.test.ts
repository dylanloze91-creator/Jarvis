import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinnhubMarketDataProvider } from './finnhub.js';
import { MarketDataError } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('FinnhubMarketDataProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuse de chercher sans clé API', async () => {
    const provider = new FinnhubMarketDataProvider({ provider: 'finnhub' });
    await expect(provider.getQuote({ query: 'nvidia' })).rejects.toThrow(/Clé API manquante/);
  });

  it('résout le symbole, récupère le cours puis le profil', async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = input.toString();
      if (url.includes('/search')) {
        return jsonResponse({
          result: [{ symbol: 'NVDA', description: 'NVIDIA CORP', type: 'Common Stock' }],
        });
      }
      if (url.includes('/quote')) {
        return jsonResponse({ c: 225.18, d: -3.69, dp: -1.612, t: 1_700_000_000 });
      }
      if (url.includes('/stock/profile2')) {
        return jsonResponse({ name: 'NVIDIA Corporation', currency: 'USD', exchange: 'NASDAQ' });
      }
      throw new Error(`URL inattendue : ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new FinnhubMarketDataProvider({ provider: 'finnhub', apiKey: 'test-key' });
    const quote = await provider.getQuote({ query: 'nvidia' });

    expect(quote).toMatchObject({
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      price: 225.18,
      currency: 'USD',
      change: -3.69,
      changePercent: -1.612,
      exchange: 'NASDAQ',
      providerId: 'finnhub',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('renvoie une cotation même si le profil échoue', async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = input.toString();
      if (url.includes('/search')) {
        return jsonResponse({ result: [{ symbol: 'NVDA', description: 'NVIDIA CORP' }] });
      }
      if (url.includes('/quote')) {
        return jsonResponse({ c: 225.18, d: -3.69, dp: -1.612, t: 1_700_000_000 });
      }
      return new Response('', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new FinnhubMarketDataProvider({ provider: 'finnhub', apiKey: 'test-key' });
    const quote = await provider.getQuote({ query: 'nvidia' });

    expect(quote.name).toBe('NVIDIA CORP');
    expect(quote.currency).toBe('USD');
  });

  it("échoue proprement quand aucun symbole n'est trouvé", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ result: [] })),
    );

    const provider = new FinnhubMarketDataProvider({ provider: 'finnhub', apiKey: 'test-key' });
    await expect(provider.getQuote({ query: 'zzzzzzz' })).rejects.toThrow(MarketDataError);
  });

  it('signale une clé invalide (401/403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );

    const provider = new FinnhubMarketDataProvider({ provider: 'finnhub', apiKey: 'bad-key' });
    await expect(provider.getQuote({ query: 'nvidia' })).rejects.toThrow(
      /Clé API Finnhub invalide/,
    );
  });
});
