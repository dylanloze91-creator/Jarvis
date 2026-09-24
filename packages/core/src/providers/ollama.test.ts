import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessage } from '../types.js';
import {
  OllamaProvider,
  detectLeakedToolCallAttempt,
  OLLAMA_RECOMMENDED_NUM_CTX,
} from './ollama.js';
import { ProviderError, type ChatStreamEvent, type ToolSchema } from './types.js';

function ndjsonResponse(lines: unknown[], status = 200): Response {
  const body = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  return new Response(body, { status });
}

async function collect(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const tools: ToolSchema[] = [
  {
    name: 'get_system_info',
    description: 'Infos système',
    parameters: { type: 'object', properties: {} },
  },
];

describe('OllamaProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('convertit un appel d’outil structuré en ToolCall, sans le confondre avec `stop`', async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_1', function: { index: 0, name: 'get_system_info', arguments: {} } },
            ],
          },
          done: false,
        },
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider({ provider: 'ollama', model: 'qwen2.5:3b' });
    const events = await collect(
      provider.streamChat({ messages: [createMessage('user', 'État de la machine ?')], tools }),
    );

    expect(events).toEqual([
      { type: 'tool_call', call: { id: 'call_1', name: 'get_system_info', arguments: {} } },
      { type: 'done', finishReason: 'tool_calls' },
    ]);
  });

  it('transmet le catalogue d’outils et la fenêtre de contexte recommandée dans la requête', async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        { message: { role: 'assistant', content: 'Bonjour' }, done: true, done_reason: 'stop' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider({
      provider: 'ollama',
      model: 'qwen2.5:3b',
      baseUrl: 'http://127.0.0.1:11434',
    });
    await collect(provider.streamChat({ messages: [createMessage('user', 'Salut')], tools }));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('qwen2.5:3b');
    expect(body.options.num_ctx).toBe(OLLAMA_RECOMMENDED_NUM_CTX);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_system_info',
          description: 'Infos système',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
  });

  it('regroupe une courte réponse texte en un seul événement (sous la fenêtre d’observation)', async () => {
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        { message: { role: 'assistant', content: 'Bon' }, done: false },
        { message: { role: 'assistant', content: 'jour' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
      ]),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'qwen2.5:3b' });
    const events = await collect(
      provider.streamChat({ messages: [createMessage('user', 'Salut')] }),
    );

    expect(events).toEqual([
      { type: 'text', delta: 'Bonjour' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('repasse en flux progressif une fois la réponse jugée sûre (au-delà de la fenêtre d’observation)', async () => {
    const words = [
      'Voici ',
      'une ',
      'réponse ',
      'suffisamment ',
      'longue ',
      'pour ',
      'dépasser ',
      'le ',
      'seuil.',
    ];
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        ...words.map((word) => ({ message: { role: 'assistant', content: word }, done: false })),
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
      ]),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'qwen2.5:3b' });
    const events = await collect(
      provider.streamChat({ messages: [createMessage('user', 'Salut')] }),
    );

    const textEvents = events.filter((event) => event.type === 'text');
    expect(textEvents.length).toBeGreaterThan(1);
    const full = textEvents.map((event) => (event.type === 'text' ? event.delta : '')).join('');
    expect(full).toBe(words.join(''));
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it("refuse un appel d'outil sans nom de fonction plutôt que de l'exécuter à moitié", async () => {
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'x', function: { arguments: {} } }],
          },
          done: true,
          done_reason: 'stop',
        },
      ]),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'qwen2.5:1.5b' });
    await expect(
      collect(provider.streamChat({ messages: [createMessage('user', 'x')], tools })),
    ).rejects.toThrow(/sans nom de fonction/);
  });

  it('refuse un appel d’outil dont les arguments ne sont pas un JSON valide', async () => {
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'x', function: { name: 'get_system_info', arguments: 'pas-du-json{' } },
            ],
          },
          done: true,
          done_reason: 'stop',
        },
      ]),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'qwen2.5:1.5b' });
    await expect(
      collect(provider.streamChat({ messages: [createMessage('user', 'x')], tools })),
    ).rejects.toThrow(/arguments illisibles/);
  });

  it("détecte une syntaxe d'appel d'outil qui a fui en texte brut au lieu du canal structuré", async () => {
    const leaked = '<tool_call>{"name": "get_system_info", "arguments": {}}</tool_call>';
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        { message: { role: 'assistant', content: leaked }, done: true, done_reason: 'stop' },
      ]),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'un-modele-mal-configure' });
    await expect(
      collect(provider.streamChat({ messages: [createMessage('user', 'x')], tools })),
    ).rejects.toThrow(/texte brut/);
  });

  it("ne laisse jamais la syntaxe fuitée atteindre l'utilisateur, même diffusée en petits morceaux", async () => {
    const leaked = '<tool_call>{"name": "get_system_info", "arguments": {}}</tool_call>';
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        ...leaked
          .split('')
          .map((char) => ({ message: { role: 'assistant', content: char }, done: false })),
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
      ]),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'un-modele-mal-configure' });
    let caught: unknown = null;
    const events: ChatStreamEvent[] = [];
    try {
      for await (const event of provider.streamChat({
        messages: [createMessage('user', 'x')],
        tools,
      })) {
        events.push(event);
      }
    } catch (error) {
      caught = error;
    }

    expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
    expect(caught).toBeInstanceOf(ProviderError);
  });

  it("signale clairement qu'un modèle ne gère pas l'appel d'outils (erreur HTTP 400 d'Ollama)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'model "x" does not support tools' }), {
            status: 400,
          }),
      ),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'tinyllama' });
    await expect(
      collect(provider.streamChat({ messages: [createMessage('user', 'x')], tools })),
    ).rejects.toThrow(/ne gère pas l'appel d'outils/);
  });

  it("signale qu'un modèle n'est pas installé (erreur HTTP 404)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: "model 'x' not found" }), { status: 404 }),
      ),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'introuvable:9b' });
    await expect(
      collect(provider.streamChat({ messages: [createMessage('user', 'x')] })),
    ).rejects.toThrow(/n'est pas installé/);
  });

  it('distingue un serveur absent (connexion refusée) d’une autre panne réseau', async () => {
    const refused = new Error('fetch failed');
    (refused as Error & { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw refused;
      }),
    );

    const provider = new OllamaProvider({ provider: 'ollama', model: 'qwen2.5:3b' });
    await expect(
      collect(provider.streamChat({ messages: [createMessage('user', 'x')] })),
    ).rejects.toThrow(/Aucun serveur Ollama ne répond/);
  });
});

describe('detectLeakedToolCallAttempt', () => {
  it('reconnaît les balises Hermes/Qwen', () => {
    expect(
      detectLeakedToolCallAttempt('<tool_call>{"name":"x","arguments":{}}</tool_call>'),
    ).not.toBeNull();
  });

  it('reconnaît un objet JSON nu imitant un appel de fonction', () => {
    expect(
      detectLeakedToolCallAttempt('{"name": "get_system_info", "arguments": {}}'),
    ).not.toBeNull();
  });

  it('laisse passer une réponse texte normale', () => {
    expect(detectLeakedToolCallAttempt('Bonjour, comment puis-je vous aider ?')).toBeNull();
  });

  it('ignore le texte vide', () => {
    expect(detectLeakedToolCallAttempt('   ')).toBeNull();
  });
});
