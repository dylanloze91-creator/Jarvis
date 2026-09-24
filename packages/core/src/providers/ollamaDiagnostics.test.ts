import { afterEach, describe, expect, it, vi } from 'vitest';
import { testOllamaConnection } from './ollamaDiagnostics.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function ndjsonResponse(lines: unknown[]): Response {
  return new Response(lines.map((line) => JSON.stringify(line)).join('\n') + '\n', { status: 200 });
}

const installedModel = {
  name: 'qwen2.5:3b',
  size: 1929912432,
  details: { parameter_size: '3.1B', quantization_level: 'Q4_K_M', context_length: 32768 },
  capabilities: ['completion', 'tools'],
};

describe('testOllamaConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('valide les trois étapes quand tout fonctionne, appel d’outil réel inclus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/tags')) return jsonResponse({ models: [installedModel] });
        if (url.endsWith('/api/version')) return jsonResponse({ version: '0.34.4' });
        if (url.endsWith('/api/chat') && init?.method === 'POST') {
          return ndjsonResponse([
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'c1',
                    function: {
                      index: 0,
                      name: 'jarvis_diagnostic_ping',
                      arguments: { echo: 'jarvis-ok' },
                    },
                  },
                ],
              },
              done: true,
              done_reason: 'stop',
            },
          ]);
        }
        throw new Error(`URL inattendue dans le test : ${url}`);
      }),
    );

    const result = await testOllamaConnection({ model: 'qwen2.5:3b' });

    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => [s.id, s.ok, s.skipped])).toEqual([
      ['server', true, false],
      ['model', true, false],
      ['toolCalling', true, false],
    ]);
  });

  it('arrête après l’étape « modèle » quand il n’est pas installé, sans tenter l’appel d’outil', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/api/tags')) return jsonResponse({ models: [] });
        if (url.endsWith('/api/version')) return jsonResponse({ version: '0.34.4' });
        throw new Error(`URL inattendue dans le test : ${url}`);
      }),
    );

    const result = await testOllamaConnection({ model: 'qwen2.5:3b' });

    expect(result.ok).toBe(false);
    const [server, model, toolCalling] = result.steps;
    expect(server?.ok).toBe(true);
    expect(model).toMatchObject({ ok: false, skipped: false });
    expect(model?.message).toMatch(/ollama pull qwen2\.5:3b/);
    expect(toolCalling).toMatchObject({ ok: false, skipped: true });
  });

  it('s’arrête dès l’étape « serveur » quand Ollama n’est pas démarré', async () => {
    const refused = new Error('fetch failed');
    (refused as Error & { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw refused;
      }),
    );

    const result = await testOllamaConnection({ model: 'qwen2.5:3b' });

    expect(result.ok).toBe(false);
    const [server, model, toolCalling] = result.steps;
    expect(server).toMatchObject({ ok: false, skipped: false });
    expect(model).toMatchObject({ ok: false, skipped: true });
    expect(toolCalling).toMatchObject({ ok: false, skipped: true });
  });

  it('détecte un modèle qui ignore silencieusement l’outil demandé (répond en texte plutôt que d’appeler)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/tags')) return jsonResponse({ models: [installedModel] });
        if (url.endsWith('/api/version')) return jsonResponse({ version: '0.34.4' });
        if (url.endsWith('/api/chat') && init?.method === 'POST') {
          return ndjsonResponse([
            {
              message: { role: 'assistant', content: 'Je vais vérifier.' },
              done: true,
              done_reason: 'stop',
            },
          ]);
        }
        throw new Error(`URL inattendue dans le test : ${url}`);
      }),
    );

    const result = await testOllamaConnection(
      { model: 'qwen2.5:3b' },
      { toolCallingTimeoutMs: 1000 },
    );

    expect(result.ok).toBe(false);
    const toolCalling = result.steps.find((s) => s.id === 'toolCalling');
    expect(toolCalling?.ok).toBe(false);
    expect(toolCalling?.message).toMatch(/sans jamais appeler/);
  });
});
