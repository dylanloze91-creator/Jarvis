import { describe, expect, it } from 'vitest';
import { isOllamaLoadOnly } from '@jarvis/core';
import { warmOllamaModels } from './warmupRun.js';

describe('préchauffage Ollama', () => {
  it('envoie un prompt vide et aucun message', async () => {
    const bodies: unknown[] = [];
    await warmOllamaModels(
      {
        provider: 'ollama',
        model: 'qwen2.5:7b',
        orchestra: {
          enabled: true,
          brain: 'qwen2.5:7b',
          router: { model: 'jarvis-trieur' },
          teams: { conversation: { model: 'qwen2.5:3b' } },
        },
      },
      'http://127.0.0.1:11434',
      async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('{}', { status: 200 });
      },
    );
    expect(bodies).toHaveLength(2);
    expect(bodies.every((body) => isOllamaLoadOnly(body))).toBe(true);
    expect(JSON.stringify(bodies)).not.toContain('bonjour');
  });
});

describe('préchauffage Ollama aligné sur le chat (Jarvis Test)', () => {
  it('chaque chargement porte les options du chat ; sans elles, rien d’ajouté', async () => {
    const settings = {
      provider: 'ollama',
      model: 'qwen2.5:3b',
      orchestra: { enabled: true, brain: 'qwen2.5:7b', teams: { conversation: { model: 'qwen2.5:3b' } } },
    };
    const sent = async (optionsFor?: (model: string) => { num_ctx: number; num_gpu?: number }) => {
      const bodies: Record<string, unknown>[] = [];
      await warmOllamaModels(
        settings,
        'http://127.0.0.1:11434',
        async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return new Response('{}', { status: 200 });
        },
        optionsFor,
      );
      return bodies;
    };
    const aligned = await sent((model) => (model === 'qwen2.5:7b' ? { num_ctx: 8192 } : { num_ctx: 8192, num_gpu: 0 }));
    expect(aligned.map((body) => body.options)).toEqual([{ num_ctx: 8192 }, { num_ctx: 8192, num_gpu: 0 }]);
    expect(aligned.every((body) => isOllamaLoadOnly(body))).toBe(true);
    expect((await sent()).every((body) => !('options' in body))).toBe(true);
  });
});
