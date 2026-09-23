import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent, type AgentEvent } from './agent.js';
import { ToolManager, defineTool } from '../tools/manager.js';
import type { ChatRequest, ChatStreamEvent, LLMProvider } from '../providers/types.js';
import { createMessage } from '../types.js';

/** Provider scripté : chaque appel consomme le tour suivant du scénario. */
class ScriptedProvider implements LLMProvider {
  readonly id = 'scripted';
  readonly label = 'Scripted';
  readonly model = 'test';
  readonly requiresApiKey = false;
  readonly requests: ChatRequest[] = [];
  private turn = 0;

  constructor(private readonly script: ChatStreamEvent[][]) {}

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    this.requests.push(request);
    const events = this.script[this.turn] ?? [{ type: 'done', finishReason: 'stop' }];
    this.turn += 1;
    for (const event of events) yield event;
  }
}

const systemInfo = defineTool({
  name: 'get_system_info',
  description: 'État de la machine.',
  risk: 'safe',
  schema: z.object({}),
  execute: async () => ({ ok: true, content: 'CPU 12 %, RAM 8 Go libres' }),
});

async function collect(agent: Agent, prompt: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.run([createMessage('user', prompt)], {
    requestConfirmation: async () => true,
  })) {
    events.push(event);
  }
  return events;
}

describe('Agent', () => {
  it('diffuse une réponse textuelle puis termine', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'text', delta: 'Bon' },
        { type: 'text', delta: 'jour' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const agent = new Agent(provider, new ToolManager(), { systemPrompt: 'test' });

    const events = await collect(agent, 'salut');
    const deltas = events.filter((e) => e.type === 'assistant_delta').map((e) => e.delta);

    expect(deltas.join('')).toBe('Bonjour');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('exécute un outil puis relance le modèle avec son résultat', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'get_system_info', arguments: {} } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', delta: 'Ta machine respire.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const agent = new Agent(provider, new ToolManager().register(systemInfo), {
      systemPrompt: 'test',
    });

    const events = await collect(agent, 'comment va mon pc ?');
    const toolResult = events.find((e) => e.type === 'tool_result');

    expect(toolResult?.outcome.status).toBe('ok');
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'CPU 12 %, RAM 8 Go libres',
    });
  });

  it("propage l'erreur du provider sans relancer la boucle", async () => {
    const provider = new ScriptedProvider([[{ type: 'error', message: 'clé invalide' }]]);
    const agent = new Agent(provider, new ToolManager(), { systemPrompt: 'test' });

    const events = await collect(agent, 'salut');

    expect(events).toEqual([{ type: 'error', message: 'clé invalide' }]);
    expect(provider.requests).toHaveLength(1);
  });

  it('coupe une boucle d’outils sans fin', async () => {
    const loop: ChatStreamEvent[] = [
      { type: 'tool_call', call: { id: 'c', name: 'get_system_info', arguments: {} } },
      { type: 'done', finishReason: 'tool_calls' },
    ];
    const provider = new ScriptedProvider([loop, loop, loop, loop]);
    const agent = new Agent(provider, new ToolManager().register(systemInfo), {
      systemPrompt: 'test',
      maxToolRounds: 2,
    });

    const events = await collect(agent, 'boucle');

    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(provider.requests).toHaveLength(3);
  });

  it('transmet le catalogue des outils au provider', async () => {
    const provider = new ScriptedProvider([[{ type: 'done', finishReason: 'stop' }]]);
    const agent = new Agent(provider, new ToolManager().register(systemInfo), {
      systemPrompt: 'prompt système',
    });

    await collect(agent, 'salut');

    expect(provider.requests[0]?.system).toBe('prompt système');
    expect(provider.requests[0]?.tools?.map((t) => t.name)).toEqual(['get_system_info']);
  });
});
