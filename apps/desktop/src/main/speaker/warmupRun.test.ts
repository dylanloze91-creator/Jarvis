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
