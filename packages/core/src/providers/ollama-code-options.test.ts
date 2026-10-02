import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from './ollama.js';
import type { ChatStreamEvent } from './types.js';

const FINAL = {
  done: true,
  done_reason: 'stop',
  total_duration: 2_000_000_000,
  load_duration: 500_000_000,
  prompt_eval_count: 400,
  prompt_eval_duration: 1_000_000_000,
  eval_count: 60,
  eval_duration: 4_000_000_000,
};

async function run(config: ConstructorParameters<typeof OllamaProvider>[0], chunks: unknown[]) {
  let body: Record<string, unknown> = {};
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(chunks.map((chunk) => `${JSON.stringify(chunk)}\n`).join(''));
  });
  const events: ChatStreamEvent[] = [];
  for await (const event of new OllamaProvider(config).streamChat({
    messages: [{ id: 'u', role: 'user', content: 'x', createdAt: 1 }],
  })) {
    events.push(event);
  }
  return { body, events };
}

afterEach(() => vi.unstubAllGlobals());

describe('options du modèle de code (Jarvis Développeur)', () => {
  it('contexte, couches GPU, fils, réflexion coupée et maintien en mémoire envoyés ; mesures rendues', async () => {
    const { body, events } = await run(
      {
        provider: 'ollama',
        model: 'qwen3.6:35b-a3b-coding',
        ollama: { numCtx: 32_768, numGpu: 99, numThread: 8, think: false, keepAlive: '30m' },
      },
      [{ message: { role: 'assistant', content: 'ok' } }, FINAL],
    );
    expect(body).toMatchObject({
      think: false,
      keep_alive: '30m',
      options: { num_ctx: 32_768, num_gpu: 99, num_thread: 8 },
    });
    expect(events.at(-1)).toEqual({
      type: 'done',
      finishReason: 'stop',
      usage: {
        promptTokens: 400,
        promptMs: 1_000,
        outputTokens: 60,
        outputMs: 4_000,
        loadMs: 500,
        totalMs: 2_000,
      },
    });
  });

  it('options partielles : seules celles données partent (réflexion non envoyée pour Qwen3-Coder)', async () => {
    const { body } = await run(
      { provider: 'ollama', model: 'qwen3-coder:30b', ollama: { numCtx: 16_384 } },
      [FINAL],
    );
    expect(body).not.toHaveProperty('think');
    expect(body).not.toHaveProperty('keep_alive');
    expect(body.options).toEqual({ temperature: 0.25, num_ctx: 16_384 });
  });

  it('sans options : aucune mesure ajoutée aux événements du chat', async () => {
    const { body, events } = await run({ provider: 'ollama', model: 'qwen2.5:3b' }, [
      { message: { role: 'assistant', content: 'Bonjour' } },
      FINAL,
    ]);
    expect(body.options).toEqual({ temperature: 0.25, num_ctx: 8192 });
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });
});
