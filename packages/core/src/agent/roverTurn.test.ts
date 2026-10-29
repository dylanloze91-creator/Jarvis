import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent, DEFAULT_SYSTEM_PROMPT } from './agent.js';
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

function catalog(configured: boolean) {
  return new ToolManager().registerAll([
    tool('web_search', 'Résultat web.'),
    tool('spotify_pause', 'Musique en pause.'),
    tool('rover_move', 'Mouvement terminé (distance mesurée 50 cm).', () => configured),
    tool('rover_stop', 'Robot arrêté.', () => configured),
  ]);
}

const OK: ChatStreamEvent[][] = [[{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]];

async function run(agent: Agent, history: ChatMessage[]) {
  const events = [];
  for await (const event of agent.run(history, { requestConfirmation: async () => true })) events.push(event);
  return events;
}

describe('Agent et robot', () => {
  it('sans robot réglé : catalogue et prompt identiques à avant', async () => {
    const provider = new ScriptedProvider(OK);
    await run(new Agent(provider, catalog(false), { systemPrompt: DEFAULT_SYSTEM_PROMPT, temperature: 0.4 }), [
      createMessage('user', 'Fais avancer le robot de 50 cm'),
    ]);
    const request = provider.requests[0]!;
    expect(request.tools?.map((schema) => schema.name)).toEqual(['web_search']);
    expect(request.system).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(request.temperature).toBe(0.4);
  });

  it('robot réglé, demande sans rapport : pas d’outils rover_*, prompt inchangé', async () => {
    const provider = new ScriptedProvider(OK);
    await run(new Agent(provider, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT, temperature: 0.4 }), [
      createMessage('user', 'Ouvre le Bloc-notes'),
    ]);
    const request = provider.requests[0]!;
    expect(request.tools?.map((schema) => schema.name)).toEqual(['web_search']);
    expect(request.system).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('un ordre au robot propose ses outils, ajoute ses règles et baisse la température', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'tool_call', call: { id: 'r1', name: 'rover_move', arguments: { distanceM: 0.5 } } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [{ type: 'text', delta: 'Le robot a avancé de 50 cm.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    const events = await run(
      new Agent(provider, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT, temperature: 0.4 }),
      [createMessage('user', 'Fais avancer le robot de 50 cm')],
    );
    const first = provider.requests[0]!;
    expect(first.tools?.map((schema) => schema.name)).toEqual(['web_search', 'rover_move', 'rover_stop']);
    expect(first.system).toContain('ROBOT :');
    expect(first.temperature).toBeLessThanOrEqual(0.2);
    const results = events.filter((event) => event.type === 'tool_result');
    expect(results).toHaveLength(1);
  });

  it('« arrête le robot » ne part pas vers Spotify', async () => {
    const provider = new ScriptedProvider(OK);
    await run(new Agent(provider, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT }), [
      createMessage('user', 'Arrête le robot'),
    ]);
    const names = provider.requests[0]!.tools?.map((schema) => schema.name);
    expect(names).toContain('rover_stop');
    expect(names).not.toContain('spotify_pause');
  });

  it('« arrête la musique » reste un tour Spotify', async () => {
    const provider = new ScriptedProvider(OK);
    await run(new Agent(provider, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT }), [
      createMessage('user', 'Arrête la musique'),
    ]);
    const names = provider.requests[0]?.tools?.map((schema) => schema.name) ?? [];
    expect(names).not.toContain('rover_stop');
  });

  it('un suivi (« encore 20 cm », « stop ») garde les outils du robot', async () => {
    const provider = new ScriptedProvider(OK);
    const history: ChatMessage[] = [
      createMessage('user', 'Fais avancer le robot de 50 cm'),
      createMessage('assistant', '', { toolCalls: [{ id: 'x', name: 'rover_move', arguments: { distanceM: 0.5 } }] }),
      createMessage('tool', 'ok', { toolCallId: 'x', toolName: 'rover_move', toolStatus: 'ok' }),
      createMessage('assistant', 'Fait.'),
      createMessage('user', 'Stop'),
    ];
    await run(new Agent(provider, catalog(true), { systemPrompt: DEFAULT_SYSTEM_PROMPT }), history);
    expect(provider.requests[0]!.tools?.map((schema) => schema.name)).toContain('rover_stop');
  });
});
