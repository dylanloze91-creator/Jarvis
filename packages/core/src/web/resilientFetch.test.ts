import { describe, expect, it, vi } from 'vitest';
import { fetchPublicText, retryAfterMs } from './resilientFetch.js';

describe('retryAfterMs', () => {
  it('honore Retry-After en secondes, borné', () => {
    expect(retryAfterMs('2', 0)).toBe(2000);
    expect(retryAfterMs('30', 0, 8_000)).toBe(8_000);
  });

  it('retombe sur un délai exponentiel', () => {
    expect(retryAfterMs(null, 1)).toBe(800);
  });
});

describe('fetchPublicText', () => {
  it('retente un 429 puis lit la page', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('slow', { status: 429, headers: { 'retry-after': '0' } });
      }
      return new Response('<html><title>Ok</title><p>Contenu utile de la page publique.</p></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    const result = await fetchPublicText('https://example.com/a', { fetchImpl, timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toMatch(/Contenu utile/);
    expect(calls).toBe(2);
  });

  it('signale un 503 épuisé comme erreur récupérable', async () => {
    const fetchImpl = vi.fn(async () => new Response('down', { status: 503, headers: { 'retry-after': '0' } }));
    const result = await fetchPublicText('https://example.com/down', {
      fetchImpl,
      maxRetries: 1,
      timeoutMs: 500,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe('recoverable');
      expect(result.userMessage).toMatch(/temporairement indisponible/);
      expect(result.userMessage).not.toMatch(/ECONNRESET/);
    }
  });

  it('refuse une URL invalide', async () => {
    const result = await fetchPublicText('pas une url', { fetchImpl: vi.fn() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.userMessage).toMatch(/invalide/i);
  });

  it('suit une redirection', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/start')) {
        return new Response(null, { status: 302, headers: { location: 'https://example.com/end' } });
      }
      return new Response('page finale assez longue pour être lue correctement ici.', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    });
    const result = await fetchPublicText('https://example.com/start', { fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('https://example.com/end');
  });
});
