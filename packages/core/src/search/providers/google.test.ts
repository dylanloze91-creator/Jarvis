import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleSearchProvider } from './google.js';

describe('GoogleSearchProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extrait les résultats organiques sans clé API', async () => {
    const html = `
      <html><body>
        <a href="/url?q=https%3A%2F%2Fexample.com%2Fpage&sa=U"><h3>Exemple</h3></a>
        <div>Une description utile de la page.</div>
        <a href="/url?q=https%3A%2F%2Fexample.org%2Fother&sa=U"><h3>Autre résultat</h3></a>
      </body></html>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { status: 200 })),
    );

    const provider = new GoogleSearchProvider();
    const result = await provider.search({ query: 'test', limit: 5 });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.title).toBe('Exemple');
    expect(result.results[0]?.url).toBe('https://example.com/page');
    expect(result.results[0]?.source).toBe('example.com');
  });

  it('refuse une requête vide', async () => {
    const provider = new GoogleSearchProvider();
    await expect(provider.search({ query: '   ' })).rejects.toThrow(/requête non vide/i);
  });

  it('retente une erreur transitoire puis récupère les résultats', async () => {
    const html = '<a href="/url?q=https%3A%2F%2Fexample.com%2Fpage"><h3>Exemple</h3></a>';
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? new Response('temporary', { status: 503 })
          : new Response(html, { status: 200 });
      }),
    );

    const provider = new GoogleSearchProvider();
    const result = await provider.search({ query: 'test', limit: 1 });

    expect(calls).toBe(2);
    expect(result.results[0]?.url).toBe('https://example.com/page');
  });

  it('signale une page anti-robot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Our systems have detected unusual traffic', { status: 200 })),
    );
    const provider = new GoogleSearchProvider();
    await expect(provider.search({ query: 'test' })).rejects.toThrow(/anti-robot|vérification/i);
  });
});
