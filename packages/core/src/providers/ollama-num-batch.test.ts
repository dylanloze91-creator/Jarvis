import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from './ollama.js';
import type { ProviderConfig } from './types.js';

async function sentBody(config: ProviderConfig): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(
      `${JSON.stringify({ message: { role: 'assistant', content: 'ok' } })}\n${JSON.stringify({ done: true, done_reason: 'stop' })}\n`,
    );
  });
  for await (const event of new OllamaProvider(config).streamChat({
    messages: [{ id: 'u', role: 'user', content: 'x', createdAt: 1 }],
  })) {
    void event;
  }
  return body;
}

afterEach(() => vi.unstubAllGlobals());

describe('num_batch (0.5.0, facultatif)', () => {
  it('envoyé seulement quand numBatch est fourni', async () => {
    const body = await sentBody({
      provider: 'ollama',
      model: 'candidat:test',
      ollama: { numCtx: 16_384, numBatch: 1024 },
    });
    expect(body.options).toEqual({ temperature: 0.25, num_ctx: 16_384, num_batch: 1024 });
  });

  it('absent des options du modèle de code sans numBatch', async () => {
    const body = await sentBody({
      provider: 'ollama',
      model: 'candidat:test',
      ollama: { numCtx: 32_768, numGpu: 99, numThread: 8 },
    });
    expect(body.options).not.toHaveProperty('num_batch');
  });

  it('absent de la requête du chat (aucune option de code)', async () => {
    const body = await sentBody({ provider: 'ollama', model: 'qwen2.5:3b' });
    expect(body.options).toEqual({ temperature: 0.25, num_ctx: 8192 });
  });
});
