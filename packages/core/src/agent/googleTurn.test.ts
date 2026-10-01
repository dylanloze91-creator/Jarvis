import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent, DEFAULT_SYSTEM_PROMPT, composeSystemPrompt } from './agent.js';
import { ToolManager, defineTool } from '../tools/manager.js';
import type { ChatRequest, ChatStreamEvent, LLMProvider } from '../providers/types.js';
import { createMessage, type ChatMessage } from '../types.js';

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

const tool = (name: string, content: string, available?: () => boolean) =>
  defineTool({
    name,
    description: name,
    risk: 'safe',
    schema: z.object({}).passthrough(),
    ...(available ? { isAvailable: available } : {}),
    execute: async () => ({ ok: true, content }),
  });

function catalog(connected: boolean) {
  return new ToolManager().registerAll([
    tool('web_search', 'Météo demain : 18 °C, éclaircies.'),
    tool('search_jarvis_memory', 'Souvenir : réunion projet Atlas.'),
    tool('google_calendar_list', 'Demain : 10:00 Réunion Atlas.', () => connected),
    tool('google_gmail_search', 'Aucun mail.', () => connected),
  ]);
}

async function run(agent: Agent, history: ChatMessage[]) {
  const events = [];
  for await (const event of agent.run(history, { requestConfirmation: async () => true })) events.push(event);
  return events;
}

describe('Agent et Google', () => {
  it('sans compte Google : catalogue et prompt identiques à avant', async () => {
    const provider = new ScriptedProvider([[{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]]);
    await run(new Agent(provider, catalog(false), { systemPrompt: DEFAULT_SYSTEM_PROMPT }), [
      createMessage('user', 'Regarde mon agenda de demain'),
    ]);
    const request = provider.requests[0]!;
    expect(request.tools?.map((schema) => schema.name)).toEqual(['web_search', 'search_jarvis_memory']);
    expect(request.system).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(request.system).not.toContain('GOOGLE');
  });

  it('connecté, mais demande sans rapport : pas d’outils Google, prompt inchangé', async () => {
    const provider = new ScriptedProvider([[{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]]);
    await run(new Agent(provider, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT, temperature: 0.4 }), [
      createMessage('user', 'Ouvre Google Chrome'),
    ]);
    const request = provider.requests[0]!;
    expect(request.tools?.map((schema) => schema.name)).toEqual(['web_search', 'search_jarvis_memory']);
    expect(request.system).toBe(composeSystemPrompt(DEFAULT_SYSTEM_PROMPT, false, true));
    expect(request.system).not.toContain('GOOGLE :');

    const plain = new ScriptedProvider([[{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]]);
    await run(new Agent(plain, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT, temperature: 0.4 }), [
      createMessage('user', 'Ouvre le Bloc-notes'),
    ]);
    expect(plain.requests[0]!.system).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(plain.requests[0]!.temperature).toBe(0.4);
  });

  it('enchaîne agenda, météo et mémoire dans un même tour', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'google_calendar_list', arguments: { period: 'tomorrow' } } },
        { type: 'tool_call', call: { id: 'c2', name: 'web_search', arguments: { query: 'météo demain' } } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [
        { type: 'tool_call', call: { id: 'c3', name: 'search_jarvis_memory', arguments: { query: 'Atlas' } } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [{ type: 'text', delta: 'Demain : réunion Atlas à 10:00, 18 °C.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    const events = await run(new Agent(provider, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT }), [
      createMessage('user', 'Regarde mon agenda de demain et vérifie la météo'),
    ]);
    const first = provider.requests[0]!;
    expect(first.tools?.map((schema) => schema.name)).toEqual([
      'web_search',
      'search_jarvis_memory',
      'google_calendar_list',
      'google_gmail_search',
    ]);
    expect(first.system).toContain('GOOGLE : nous sommes le');
    expect(first.system).toContain('PROTOCOLE RECHERCHE');
    expect(first.temperature).toBeLessThanOrEqual(0.2);
    const results = events.filter((event) => event.type === 'tool_result').map((event) => event.type === 'tool_result' && event.outcome.name);
    expect(results).toEqual(['google_calendar_list', 'web_search', 'search_jarvis_memory']);
    expect(provider.requests).toHaveLength(3);
  });

  it('un suivi sans mot-clé garde les outils Google après un échange Google', async () => {
    const provider = new ScriptedProvider([[{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]]);
    const history: ChatMessage[] = [
      createMessage('user', 'Prépare un brouillon pour Paul'),
      createMessage('assistant', '', {
        toolCalls: [{ id: 'x', name: 'google_gmail_search', arguments: {} }],
      }),
      createMessage('tool', 'ok', { toolCallId: 'x', toolName: 'google_gmail_search', toolStatus: 'ok' }),
      createMessage('assistant', 'Brouillon prêt.'),
      createMessage('user', 'Envoie-le'),
    ];
    await run(new Agent(provider, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT }), history);
    expect(provider.requests[0]!.tools?.map((schema) => schema.name)).toContain('google_gmail_search');
  });

  it('garde le plafond de tours d’outils', async () => {
    const loop: ChatStreamEvent[] = [
      { type: 'tool_call', call: { id: 'l', name: 'google_calendar_list', arguments: {} } },
      { type: 'done', finishReason: 'tool_calls' },
    ];
    const provider = new ScriptedProvider(Array.from({ length: 20 }, () => loop));
    const events = await run(new Agent(provider, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT, maxToolRounds: 50 }), [
      createMessage('user', 'Mon agenda ?'),
    ]);
    expect(provider.requests.length).toBeLessThanOrEqual(7);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });
});
