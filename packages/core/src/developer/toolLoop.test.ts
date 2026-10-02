import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatRequest, ChatStreamEvent, LLMProvider } from '../providers/types.js';
import { defineTool, ToolManager } from '../tools/manager.js';
import { toolSuccess } from '../tools/outcome.js';
import { runToolLoop, toolView } from './toolLoop.js';

function provider(replies: ChatStreamEvent[][]): LLMProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    id: 'fake',
    label: 'fake',
    model: 'fake',
    requiresApiKey: false,
    requests,
    async *streamChat(request) {
      requests.push(request);
      for (const event of replies[requests.length - 1] ?? [{ type: 'done', finishReason: 'stop' }])
        yield event;
    },
  };
}

const ran: string[] = [];
const manager = new ToolManager().registerAll(
  ['lire', 'jeter'].map((name) =>
    defineTool({
      name,
      description: name,
      risk: 'safe',
      schema: z.object({}),
      execute: async () => {
        ran.push(name);
        return toolSuccess(`${name} fait`);
      },
    }),
  ),
);

describe('boucle d’outils de Jarvis Développeur', () => {
  it('vue filtrée : l’outil caché n’est ni montré ni exécuté ; un point d’arrêt avant chaque tour', async () => {
    const llm = provider([
      [
        { type: 'tool_call', call: { id: '1', name: 'jeter', arguments: {} } },
        { type: 'tool_call', call: { id: '2', name: 'lire', arguments: {} } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', delta: 'fini' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const rounds: number[] = [];
    const result = await runToolLoop({
      provider: llm,
      tools: toolView(manager, ['lire']),
      system: 's',
      prompt: 'p',
      beforeRound: async (round) => {
        rounds.push(round);
      },
    });
    expect(llm.requests[0]!.tools?.map((tool) => tool.name)).toEqual(['lire']);
    expect(ran).toEqual(['lire']);
    expect(result.calls.map((c) => [c.name, c.status])).toEqual([
      ['jeter', 'error'],
      ['lire', 'ok'],
    ]);
    expect(rounds).toEqual([1, 2]);
    expect(result).toMatchObject({ finalText: 'fini', stoppedBy: 'answer' });
  });

  it('un arrêt demandé au point d’arrêt interrompt la boucle', async () => {
    const result = await runToolLoop({
      provider: provider([]),
      tools: manager,
      system: 's',
      prompt: 'p',
      beforeRound: async () => {
        throw new Error('Annulé.');
      },
    });
    expect(result).toMatchObject({ stoppedBy: 'error', error: 'Annulé.', rounds: 1 });
  });
});
