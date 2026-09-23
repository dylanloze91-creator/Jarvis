import { afterEach, describe, expect, it, vi } from 'vitest';
import { WikipediaSearchProvider } from './wikipedia.js';
import { SearchProviderError } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('WikipediaSearchProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mappe les résultats et nettoie les extraits HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          query: {
            search: [
              { title: 'Nvidia', snippet: '<span class="x">Nvidia</span> est une société.' },
            ],
          },
        }),
      ),
    );

    const provider = new WikipediaSearchProvider();
    const response = await provider.search({ query: 'nvidia', language: 'fr' });

    expect(response.providerId).toBe('wikipedia');
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      title: 'Nvidia',
      url: 'https://fr.wikipedia.org/wiki/Nvidia',
      snippet: 'Nvidia est une société.',
      source: 'fr.wikipedia.org',
    });
    expect(response.answer).toBe('Nvidia est une société.');
  });

  it("retourne une liste vide sans planter quand il n'y a aucun résultat", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ query: { search: [] } })),
    );

    const provider = new WikipediaSearchProvider();
    const response = await provider.search({ query: 'zzzzzzzzzzzzz' });

    expect(response.results).toEqual([]);
    expect(response.answer).toBeUndefined();
  });

  it('lève une erreur exploitable en cas de panne réseau', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );

    const provider = new WikipediaSearchProvider();
    await expect(provider.search({ query: 'nvidia' })).rejects.toThrow(SearchProviderError);
  });

  it('signale une limitation de débit (429)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 })),
    );

    const provider = new WikipediaSearchProvider();
    await expect(provider.search({ query: 'nvidia' })).rejects.toThrow(/429/);
  });
});
