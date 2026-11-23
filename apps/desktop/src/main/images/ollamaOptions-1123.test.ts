import { DEFAULT_PRESETS } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { OllamaControl } from './OllamaControl.js';
import { PromptRefiner } from './PromptRefiner.js';

/**
 * 23 novembre 2026 (Jarvis Test) : autour d'une image, Imager envoie à Ollama les mêmes
 * `num_ctx` / `num_gpu` que le chat ; sans options, Ollama prenait 4 096 et rechargeait le 7B.
 */
function recorder(reply: unknown = {}) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return { bodies, fetchImpl };
}

describe('Imager : options de chargement', () => {
  it('rechargement et déchargement portent les options données', async () => {
    const { bodies, fetchImpl } = recorder();
    const control = new OllamaControl('http://127.0.0.1:11434', fetchImpl, () => ({ num_ctx: 8192 }));
    expect(await control.preload('qwen2.5:7b', '30m')).toBe(true);
    expect(bodies[0]).toMatchObject({ model: 'qwen2.5:7b', keep_alive: '30m', options: { num_ctx: 8192 } });
  });

  it('sans options données : la requête d’avant, inchangée', async () => {
    const { bodies, fetchImpl } = recorder();
    await new OllamaControl('http://127.0.0.1:11434', fetchImpl).preload('qwen2.5:7b', '30m');
    expect(bodies[0]).toEqual({ model: 'qwen2.5:7b', keep_alive: '30m', stream: false });
  });

  it('la reformulation garde sa température et ajoute le contexte du chat', async () => {
    const { bodies, fetchImpl } = recorder({ message: { content: '{"prompt":"a red bicycle in a garden","negative":""}' } });
    await new PromptRefiner('http://127.0.0.1:11434', fetchImpl, () => ({ num_ctx: 8192 }))
      .refine({ prompt: 'un vélo rouge dans un jardin', project: 'perso', preset: DEFAULT_PRESETS.perso }, 'qwen2.5:7b')
      .catch(() => undefined);
    expect(bodies[0]?.options).toMatchObject({ temperature: 0.3, num_predict: 260, num_ctx: 8192 });
  });
});
