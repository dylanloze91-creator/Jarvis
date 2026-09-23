import { describe, expect, it } from 'vitest';
import { MockProvider } from './mock.js';
import type { ChatStreamEvent, ToolSchema } from './types.js';
import { createMessage, type ChatMessage } from '../types.js';

const tools: ToolSchema[] = [
  { name: 'get_system_info', description: '', parameters: {} },
  { name: 'create_folder', description: '', parameters: {} },
];

async function run(messages: ChatMessage[]): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of new MockProvider().streamChat({ messages, tools })) {
    events.push(event);
  }
  return events;
}

function text(events: ChatStreamEvent[]): string {
  return events
    .filter((event) => event.type === 'text')
    .map((event) => event.delta)
    .join('');
}

function calls(events: ChatStreamEvent[]) {
  return events.filter((event) => event.type === 'tool_call').map((event) => event.call);
}

describe('MockProvider', () => {
  it('appelle l’outil système quand la question porte sur la machine', async () => {
    const events = await run([createMessage('user', 'Que se passe-t-il sur mon PC ?')]);
    expect(calls(events)[0]?.name).toBe('get_system_info');
  });

  it('conserve la casse du nom de dossier demandé', async () => {
    const events = await run([createMessage('user', 'Crée un dossier nommé "Rapports 2026"')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'create_folder',
      arguments: { name: 'Rapports 2026' },
    });
  });

  it('résume le résultat au lieu de rappeler l’outil dans le même tour', async () => {
    const events = await run([
      createMessage('user', 'Que se passe-t-il sur mon PC ?'),
      createMessage('assistant', '', {
        toolCalls: [{ id: 'c1', name: 'get_system_info', arguments: {} }],
      }),
      createMessage('tool', 'Mémoire : 8 Go', { toolCallId: 'c1', toolName: 'get_system_info' }),
    ]);

    expect(calls(events)).toHaveLength(0);
    expect(text(events)).toContain('Mémoire : 8 Go');
  });

  it('planifie un nouvel outil au tour suivant malgré l’historique', async () => {
    const events = await run([
      createMessage('user', 'Que se passe-t-il sur mon PC ?'),
      createMessage('assistant', '', {
        toolCalls: [{ id: 'c1', name: 'get_system_info', arguments: {} }],
      }),
      createMessage('tool', 'Mémoire : 8 Go', { toolCallId: 'c1', toolName: 'get_system_info' }),
      createMessage('assistant', 'Voici ce que j’ai obtenu.'),
      createMessage('user', 'Crée un dossier nommé "Projet"'),
    ]);

    expect(calls(events)[0]).toMatchObject({
      name: 'create_folder',
      arguments: { name: 'Projet' },
    });
  });

  it('répond sans outil quand la demande n’en réclame aucun', async () => {
    const events = await run([createMessage('user', 'Bonjour')]);
    expect(calls(events)).toHaveLength(0);
    expect(text(events).length).toBeGreaterThan(0);
  });
});
