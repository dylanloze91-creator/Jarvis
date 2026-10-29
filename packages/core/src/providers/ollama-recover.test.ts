import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider, RECOVERED_CALL_PREFIX } from './ollama.js';
import type { ChatStreamEvent, OllamaCodeOptions, ToolSchema } from './types.js';

const TOOLS: ToolSchema[] = [
  {
    name: 'write_file',
    description: 'Écrit un fichier.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
];

const LEAKED =
  '<tool_call>\n{"name": "write_file", "arguments": {"path": "src/a.mjs", "content": "export const a = 1;\nexport const b = 2;\n"}}\n</tool_call>';

/** Ollama qui renvoie le texte morceau par morceau, comme en vrai. */
async function run(options: OllamaCodeOptions | undefined, content: string, tools: ToolSchema[] | undefined) {
  let body: Record<string, unknown> = {};
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const pieces = content.match(/[\s\S]{1,7}/g) ?? [];
    const lines = [
      ...pieces.map((piece) => ({ message: { role: 'assistant', content: piece } })),
      { done: true, done_reason: 'stop' },
    ];
    return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  });
  const events: ChatStreamEvent[] = [];
  let error: unknown = null;
  try {
    for await (const event of new OllamaProvider({
      provider: 'ollama',
      model: 'qwen2.5:1.5b',
      ...(options ? { ollama: options } : {}),
    }).streamChat({
      messages: [{ id: 'u', role: 'user', content: 'x', createdAt: 1 }],
      ...(tools ? { tools } : {}),
    })) {
      events.push(event);
    }
  } catch (caught) {
    error = caught;
  }
  return { body, events, error };
}

afterEach(() => vi.unstubAllGlobals());

describe('récupération des appels d’outils écrits en texte (option du modèle de code)', () => {
  it('sans l’option (chat) : la fuite arrête toujours le tour, comme avant', async () => {
    const { error, events } = await run(undefined, LEAKED, TOOLS);
    expect(String((error as Error)?.message)).toMatch(/texte brut/);
    expect(events.filter((event) => event.type === 'tool_call')).toEqual([]);
  });

  it('avec l’option : l’appel est relu, avec le code multiligne intact', async () => {
    const { error, events } = await run({ recoverToolCalls: true }, LEAKED, TOOLS);
    expect(error).toBeNull();
    const calls = events.filter((event) => event.type === 'tool_call');
    expect(calls).toHaveLength(1);
    const call = (calls[0] as Extract<ChatStreamEvent, { type: 'tool_call' }>).call;
    expect(call.name).toBe('write_file');
    expect(call.id.startsWith(RECOVERED_CALL_PREFIX)).toBe(true);
    expect(call.arguments).toEqual({ path: 'src/a.mjs', content: 'export const a = 1;\nexport const b = 2;\n' });
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
  });

  it('l’option n’est jamais envoyée au serveur', async () => {
    const { body } = await run({ recoverToolCalls: true, numCtx: 4096 }, 'ok', TOOLS);
    expect(JSON.stringify(body)).not.toMatch(/recover/i);
    expect(body).toMatchObject({ options: { num_ctx: 4096 } });
  });

  it('sans outil proposé, une réponse JSON qui commence par {"name": arrive entière', async () => {
    const answer = '{"name": "Pong", "description": "Un jeu à deux joueurs."}';
    const { error, events } = await run({ recoverToolCalls: true }, answer, undefined);
    expect(error).toBeNull();
    const text = events.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('');
    expect(text).toBe(answer);
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('avec l’option, une fuite vers un outil non proposé reste une erreur nette', async () => {
    const { error } = await run(
      { recoverToolCalls: true },
      '<tool_call>{"name": "run_command", "arguments": {"command": "dir"}}</tool_call>',
      TOOLS,
    );
    expect(String((error as Error)?.message)).toMatch(/texte brut/);
  });

  it('avec l’option, un texte normal reste du texte', async () => {
    const { error, events } = await run({ recoverToolCalls: true }, 'Le fichier est prêt.', TOOLS);
    expect(error).toBeNull();
    expect(events.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('')).toBe('Le fichier est prêt.');
  });

  it('arguments structurés encodés en chaîne avec un retour à la ligne brut : réparés avec l’option', async () => {
    vi.stubGlobal('fetch', async () => {
      const lines = [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { function: { name: 'write_file', arguments: '{"path": "a.mjs", "content": "x\ny"}' } },
            ],
          },
        },
        { done: true, done_reason: 'stop' },
      ];
      return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
    });
    const events: ChatStreamEvent[] = [];
    for await (const event of new OllamaProvider({
      provider: 'ollama',
      model: 'm',
      ollama: { recoverToolCalls: true },
    }).streamChat({ messages: [{ id: 'u', role: 'user', content: 'x', createdAt: 1 }], tools: TOOLS })) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({ type: 'tool_call', call: { arguments: { path: 'a.mjs', content: 'x\ny' } } });
  });
});
