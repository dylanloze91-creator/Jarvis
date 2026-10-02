import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ollamaDescriptor } from '../providers/ollama.js';
import { ProviderRegistry } from '../providers/registry.js';
import type {
  ChatRequest,
  ChatStreamEvent,
  LLMProvider,
  ProviderConfig,
} from '../providers/types.js';
import { ToolManager, defineTool } from '../tools/manager.js';
import { CodeProviderRefusedError, createCodeAIProvider } from './codeProvider.js';
import { CodeModelFormatError } from './codeSchemas.js';

type Script = (request: ChatRequest, call: number) => ChatStreamEvent[];
const usage = {
  promptTokens: 100,
  promptMs: 200,
  outputTokens: 20,
  outputMs: 1_000,
  loadMs: 0,
  totalMs: 1_300,
};

function scripted(script: Script) {
  const configs: ProviderConfig[] = [];
  const requests: ChatRequest[] = [];
  const registry = new ProviderRegistry().register(ollamaDescriptor, (config): LLMProvider => {
    configs.push(config);
    return {
      id: 'ollama',
      label: 'scripté',
      model: config.model,
      requiresApiKey: false,
      async *streamChat(request) {
        requests.push(request);
        yield* script(request, requests.length);
      },
    };
  });
  return { registry, configs, requests };
}

const readTool = defineTool({
  name: 'read_file',
  description: 'Lit un fichier.',
  risk: 'safe',
  schema: z.object({ path: z.string() }),
  execute: async ({ path }) => ({ ok: true, content: `contenu de ${path}` }),
});

describe('fournisseur IA de code : local seulement', () => {
  it.each([
    [{ model: 'gpt-4o', provider: 'openai' }, /refusé.*décision 6/],
    [{ model: 'claude', provider: 'anthropic' }, /refusé/],
    [{ model: 'x', baseUrl: 'https://api.openai.com' }, /Adresse .* refusée/],
    [{ model: 'x', baseUrl: 'http://8.8.8.8:11434' }, /Adresse .* refusée/],
  ])('%j → refusé', (config, message) => {
    expect(() => createCodeAIProvider(scripted(() => []).registry, config)).toThrow(
      CodeProviderRefusedError,
    );
    expect(() => createCodeAIProvider(scripted(() => []).registry, config)).toThrow(message);
  });

  it('Ollama local (boucle ou réseau privé) accepté, réglages de requête transmis au registre', () => {
    const { registry, configs } = scripted(() => []);
    const provider = createCodeAIProvider(registry, {
      model: 'qwen3.5:4b',
      baseUrl: 'http://192.168.1.20:11434/',
      options: { numCtx: 32_768, think: false },
    });
    expect(provider).toMatchObject({
      id: 'ollama',
      locality: 'local',
      baseUrl: 'http://192.168.1.20:11434',
      model: 'qwen3.5:4b',
    });
    expect(configs[0]).toEqual({
      provider: 'ollama',
      model: 'qwen3.5:4b',
      baseUrl: 'http://192.168.1.20:11434',
      ollama: { numCtx: 32_768, think: false },
    });
    expect(createCodeAIProvider(registry, { model: 'x' }).baseUrl).toBe('http://127.0.0.1:11434');
  });
});

describe('boucle d’outils', () => {
  it('appel d’outil puis réponse ; résultats et mesures cumulés', async () => {
    const { registry, requests } = scripted((_request, call) =>
      call === 1
        ? [
            {
              type: 'tool_call',
              call: { id: 'c1', name: 'read_file', arguments: { path: 'src/a.ts' } },
            },
            { type: 'done', finishReason: 'tool_calls', usage },
          ]
        : [
            { type: 'text', delta: 'Fini.' },
            { type: 'done', finishReason: 'stop', usage },
          ],
    );
    const result = await createCodeAIProvider(registry, { model: 'm' }).runTools({
      system: 's',
      prompt: 'Lis src/a.ts',
      tools: new ToolManager().register(readTool),
    });
    expect(result).toMatchObject({
      finalText: 'Fini.',
      rounds: 2,
      stoppedBy: 'answer',
      error: null,
    });
    expect(result.calls).toEqual([
      {
        name: 'read_file',
        arguments: { path: 'src/a.ts' },
        status: 'ok',
        content: 'contenu de src/a.ts',
      },
    ]);
    expect(result.usage.outputTokens).toBe(40);
    expect(requests[1]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(requests[0]?.tools?.map((t) => t.name)).toEqual(['read_file']);
  });

  it('plafond de tours, et outil confirmé refusé par défaut', async () => {
    const write = defineTool({
      name: 'write',
      description: 'écrit',
      risk: 'confirm',
      schema: z.object({}),
      execute: async () => ({ ok: true, content: 'écrit' }),
    });
    const { registry } = scripted(() => [
      { type: 'tool_call', call: { id: 'w', name: 'write', arguments: {} } },
      { type: 'done', finishReason: 'tool_calls' },
    ]);
    const result = await createCodeAIProvider(registry, { model: 'm' }).runTools({
      system: 's',
      prompt: 'p',
      tools: new ToolManager().register(write),
      maxRounds: 3,
    });
    expect(result.stoppedBy).toBe('max-rounds');
    expect(result.calls.every((call) => call.status === 'denied')).toBe(true);
  });
});

describe('réponses structurées', () => {
  it('JSON entre balises accepté ; hors format refusé, jamais deviné', async () => {
    const good = scripted(() => [
      {
        type: 'text',
        delta:
          'Voici :\n```json\n{"summary":"Ajouter un outil","files":["src/tools/index.ts"],"steps":["importer"],"tests":["npm test"]}\n```',
      },
      { type: 'done', finishReason: 'stop' },
    ]);
    const plan = await createCodeAIProvider(good.registry, { model: 'm' }).generatePlan({
      request: 'outil version',
      context: '',
      rules: ['cœur confirmé'],
    });
    expect(plan).toEqual({
      summary: 'Ajouter un outil',
      files: ['src/tools/index.ts'],
      steps: ['importer'],
      tests: ['npm test'],
      touchesCore: false,
    });
    const bad = scripted(() => [
      { type: 'text', delta: '{"verdict":"peut-être"}' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await expect(
      createCodeAIProvider(bad.registry, { model: 'm' }).reviewCode({ diff: '+x', rules: [] }),
    ).rejects.toBeInstanceOf(CodeModelFormatError);
    const none = scripted(() => [
      { type: 'text', delta: 'Je ne sais pas.' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await expect(
      createCodeAIProvider(none.registry, { model: 'm' }).analyzeCode({ files: [], question: 'q' }),
    ).rejects.toThrow(/sans JSON/);
  });
});
