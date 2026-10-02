import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from './ollama.js';
import type { ChatRequest, ChatStreamEvent } from './types.js';

/**
 * Requêtes du chat vers Ollama figées sur 0.4.23 : `__golden__/ollama-0.4.23/`
 * a été produit par ce test sur l'arbre 0.4.23 (JARVIS_WRITE_GOLDEN=1). Sans
 * options de modèle de code, le corps envoyé et les événements rendus restent
 * identiques.
 */
const GOLDEN_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '__golden__',
  'ollama-0.4.23',
);

function golden(name: string, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const file = join(GOLDEN_DIR, `${name}.json`);
  if (process.env.JARVIS_WRITE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

function ndjson(chunks: unknown[]): Response {
  return new Response(chunks.map((chunk) => `${JSON.stringify(chunk)}\n`).join(''), {
    status: 200,
  });
}

const FINAL = {
  done: true,
  done_reason: 'stop',
  total_duration: 900_000_000,
  load_duration: 10_000_000,
  prompt_eval_count: 120,
  prompt_eval_duration: 200_000_000,
  eval_count: 30,
  eval_duration: 600_000_000,
};
const TOOLS = [
  {
    name: 'get_system_info',
    description: 'Infos système.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_file',
    description: 'Lit un fichier.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

async function capture(
  config: ConstructorParameters<typeof OllamaProvider>[0],
  request: ChatRequest,
  chunks: unknown[],
) {
  const calls: Array<{ url: string; method?: string; headers?: unknown; body: unknown }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: JSON.parse(String(init.body)),
    });
    return ndjson(chunks);
  });
  const events: ChatStreamEvent[] = [];
  for await (const event of new OllamaProvider(config).streamChat(request)) events.push(event);
  return { calls, events };
}

afterEach(() => vi.unstubAllGlobals());

describe('requêtes du chat vers Ollama identiques à 0.4.23', () => {
  it('réponse texte avec prompt système et outils', async () => {
    const result = await capture(
      { provider: 'ollama', model: 'qwen2.5:3b', baseUrl: 'http://127.0.0.1:11434/' },
      {
        system: 'Tu es Jarvis.',
        messages: [{ id: 'u1', role: 'user', content: 'Bonjour', createdAt: 1 }],
        tools: TOOLS,
        temperature: 0.4,
      },
      [
        {
          message: {
            role: 'assistant',
            content: 'Bonjour ! Comment puis-je t’aider aujourd’hui ?',
          },
        },
        FINAL,
      ],
    );
    golden('texte', result);
  });

  it('appel d’outil structuré', async () => {
    const result = await capture(
      { provider: 'ollama', model: 'qwen2.5:3b' },
      {
        messages: [{ id: 'u1', role: 'user', content: 'Lis C:\\x.txt', createdAt: 1 }],
        tools: TOOLS,
      },
      [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'read_file', arguments: { path: 'C:\\x.txt' } } }],
          },
        },
        { ...FINAL, done_reason: 'stop' },
      ],
    );
    golden('appel-outil', result);
  });

  it('historique avec appel d’outil et résultat, limite de jetons', async () => {
    const result = await capture(
      { provider: 'ollama', model: 'qwen3.5:4b', baseUrl: 'http://192.168.1.20:11434' },
      {
        system: 'Tu es Jarvis.',
        messages: [
          { id: 'u1', role: 'user', content: 'Quelle heure ?', createdAt: 1 },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            createdAt: 2,
            toolCalls: [{ id: 'c1', name: 'get_system_info', arguments: {} }],
          },
          { id: 't1', role: 'tool', content: '14:02', createdAt: 3, toolCallId: 'c1' },
        ],
        temperature: 0.2,
        maxTokens: 256,
      },
      [
        { message: { role: 'assistant', content: 'Il est 14 h 02.' } },
        { ...FINAL, done_reason: 'length' },
      ],
    );
    golden('historique', result);
  });
});
