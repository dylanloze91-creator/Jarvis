import { afterEach, describe, expect, it, vi } from 'vitest';
import { BraveSearchProvider } from './brave.js';
import { SearchProviderError } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('BraveSearchProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuse de chercher sans clé API', async () => {
    const provider = new BraveSearchProvider({ provider: 'brave' });
    await expect(provider.search({ query: 'nvidia' })).rejects.toThrow(/Clé API manquante/);
  });

  it('mappe les résultats et transmet la clé dans les en-têtes', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        web: {
          results: [
            { title: 'Nvidia', url: 'https://example.com/nvidia', description: 'La <b>page</b>.' },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new BraveSearchProvider({ provider: 'brave', apiKey: 'test-key' });
    const response = await provider.search({ query: 'nvidia' });

    expect(response.results[0]).toMatchObject({
      title: 'Nvidia',
      url: 'https://example.com/nvidia',
      snippet: 'La page.',
      source: 'example.com',
    });

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)['x-subscription-token']).toBe('test-key');
  });

  it('signale une clé invalide (401/403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    const provider = new BraveSearchProvider({ provider: 'brave', apiKey: 'bad-key' });
    await expect(provider.search({ query: 'nvidia' })).rejects.toThrow(SearchProviderError);
  });

  it('signale une panne réseau sans planter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('timeout');
      }),
    );
    const provider = new BraveSearchProvider({ provider: 'brave', apiKey: 'test-key' });
    await expect(provider.search({ query: 'nvidia' })).rejects.toThrow(/indisponible/);
  });
});
