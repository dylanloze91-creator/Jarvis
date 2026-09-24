import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkOllamaStatus } from './ollamaStatus.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('checkOllamaStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reconnaît un serveur détecté et transmet ses modèles installés, avec leur capacité outils', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [
            {
              name: 'qwen2.5:3b',
              size: 1929912432,
              details: {
                parameter_size: '3.1B',
                quantization_level: 'Q4_K_M',
                context_length: 32768,
              },
              capabilities: ['completion', 'tools'],
            },
            {
              name: 'tinyllama:latest',
              size: 637700138,
              details: { parameter_size: '1B', quantization_level: 'Q4_0' },
              capabilities: ['completion'],
            },
          ],
        });
      }
      return jsonResponse({ version: '0.34.4' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkOllamaStatus('http://127.0.0.1:11434');

    expect(result.status).toBe('detected');
    expect(result.version).toBe('0.34.4');
    expect(result.models).toEqual([
      {
        name: 'qwen2.5:3b',
        sizeBytes: 1929912432,
        parameterSize: '3.1B',
        quantizationLevel: 'Q4_K_M',
        supportsTools: true,
        contextLength: 32768,
      },
      {
        name: 'tinyllama:latest',
        sizeBytes: 637700138,
        parameterSize: '1B',
        quantizationLevel: 'Q4_0',
        supportsTools: false,
        contextLength: undefined,
      },
    ]);
  });

  it('signale un serveur absent quand la connexion est refusée', async () => {
    const refused = new Error('fetch failed');
    (refused as Error & { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw refused;
      }),
    );

    const result = await checkOllamaStatus('http://127.0.0.1:11434');
    expect(result.status).toBe('absent');
    expect(result.message).toMatch(/aucun serveur/i);
  });

  it('signale un serveur injoignable en cas de délai dépassé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      }),
    );

    const result = await checkOllamaStatus('http://127.0.0.1:11434', { timeoutMs: 5 });
    expect(result.status).toBe('unreachable');
    expect(result.message).toMatch(/répondu à temps/i);
  });

  it('signale un serveur injoignable en cas de réponse HTTP inattendue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );

    const result = await checkOllamaStatus('http://127.0.0.1:11434');
    expect(result.status).toBe('unreachable');
  });

  it('normalise l’URL de base (retire le slash final)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ models: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await checkOllamaStatus('http://127.0.0.1:11434/');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/api/tags');
  });
});
