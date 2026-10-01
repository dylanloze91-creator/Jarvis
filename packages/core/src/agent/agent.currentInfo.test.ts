import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent, CURRENT_INFO_TOOL_NAME, composeSystemPrompt, type AgentEvent } from './agent.js';
import { ToolManager, defineTool } from '../tools/manager.js';
import type { ChatRequest, ChatStreamEvent, LLMProvider } from '../providers/types.js';
import type { CurrentSearchResult } from '../search/currentSearch.js';
import { createMessage } from '../types.js';

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

const NOW = new Date('2026-10-01T19:30:00Z');
const BASE = 'Base.';

function searchResult(withSources: boolean): CurrentSearchResult {
  return {
    searchedAt: NOW.toISOString(),
    question: 'Qui est le Premier ministre actuel en France ?',
    query: 'Qui est le Premier ministre actuel en France 2026',
    newsQuery: 'Premier ministre France',
    sources: withSources
      ? [
          {
            index: 1,
            title: 'Budget 2027 : Sébastien Lecornu alerte',
            url: 'https://www.lemonde.fr/politique/budget',
            snippet: '',
            domain: 'lemonde.fr',
            publisher: 'Le Monde.fr',
            publishedAt: '2026-09-28T09:18:00Z',
            providerId: 'google-news',
            providerLabel: 'Google Actualités (RSS, sans clé)',
            kind: 'news',
          },
        ]
      : [],
    attempts: withSources
      ? []
      : [{ providerId: 'google-news', label: 'Google Actualités (RSS, sans clé)', ok: false, count: 0, ms: 5, error: 'fetch failed' }],
    providersUsed: withSources ? ['Google Actualités (RSS, sans clé)'] : [],
  };
}

function catalogue(options: { sources?: boolean; throws?: boolean } = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const record = (name: string) => (args: unknown) => calls.push({ name, args });
  const manager = new ToolManager().registerAll([
    defineTool({
      name: CURRENT_INFO_TOOL_NAME,
      description: 'interne',
      internal: true,
      risk: 'safe',
      schema: z.object({
        question: z.string(),
        query: z.string(),
        newsQuery: z.string(),
        freshness: z.enum(['day', 'week', 'month']),
        preferNews: z.boolean(),
        city: z.string().optional(),
      }),
      execute: async (args) => {
        record(CURRENT_INFO_TOOL_NAME)(args);
        if (options.throws) throw new Error('panne interne');
        const data = searchResult(options.sources ?? true);
        return data.sources.length
          ? { ok: true, content: '[1] Budget 2027 : Sébastien Lecornu alerte — Le Monde.fr', data }
          : { ok: false, outcome: 'recoverable' as const, content: 'La recherche Internet n’a rien donné.', data };
      },
    }),
    defineTool({
      name: 'web_search',
      description: 'web',
      risk: 'safe',
      schema: z.object({ query: z.string() }),
      execute: async (args) => (record('web_search')(args), { ok: true, content: 'r' }),
    }),
    defineTool({
      name: 'web_research',
      description: 'recherche approfondie',
      risk: 'safe',
      schema: z.object({ queries: z.array(z.string()).min(2).max(4), limitPerQuery: z.number().default(4) }),
      execute: async (args) => (record('web_research')(args), { ok: true, content: 'FAIT — recoupé.' }),
    }),
    defineTool({
      name: 'fetch_page',
      description: 'page',
      risk: 'safe',
      schema: z.object({ url: z.string() }),
      execute: async () => ({ ok: true, content: 'page' }),
    }),
    defineTool({
      name: 'get_system_info',
      description: 'machine',
      risk: 'safe',
      schema: z.object({}),
      execute: async () => ({ ok: true, content: 'CPU 12 %' }),
    }),
    defineTool({
      name: 'spotify_current_track',
      description: 'morceau',
      risk: 'safe',
      schema: z.object({}),
      execute: async () => (record('spotify_current_track')({}), { ok: true, content: 'Lecture : On verra — Nekfeu' }),
    }),
  ]);
  return { manager, calls };
}

async function run(agent: Agent, prompt: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.run([createMessage('user', prompt)], { requestConfirmation: async () => true })) {
    events.push(event);
  }
  return events;
}

const answer = (text: string): ChatStreamEvent[] => [
  { type: 'text', delta: text },
  { type: 'done', finishReason: 'stop' },
];

function agentWith(provider: LLMProvider, manager: ToolManager) {
  return new Agent(provider, manager, { systemPrompt: BASE, now: () => NOW, timeZone: 'Europe/Paris' });
}

describe('Agent — question d’actualité', () => {
  it('cherche sur Internet avant le modèle, injecte la date, puis cite la source', async () => {
    const provider = new ScriptedProvider([answer('Selon Le Monde, le 28 septembre, le Premier ministre est Sébastien Lecornu.')]);
    const { manager, calls } = catalogue();
    const events = await run(agentWith(provider, manager), 'Qui est le Premier ministre actuel en France ?');

    expect(events[0]).toMatchObject({ type: 'assistant_message' });
    expect(events[1]).toMatchObject({ type: 'tool_start', call: { name: CURRENT_INFO_TOOL_NAME } });
    expect(calls[0]).toMatchObject({
      name: CURRENT_INFO_TOOL_NAME,
      args: { newsQuery: 'Premier ministre France', freshness: 'month', preferNews: true },
    });
    expect(provider.requests).toHaveLength(1);
    const request = provider.requests[0]!;
    expect(request.system).toContain('Date et heure actuelles : jeudi 1 octobre 2026, 21:30');
    expect(request.system).toContain('PROTOCOLE ACTUALITÉ');
    expect(request.system).not.toContain('PROTOCOLE RECHERCHE');
    expect(request.messages.at(-1)).toMatchObject({ role: 'tool', toolName: CURRENT_INFO_TOOL_NAME });
    expect(request.tools?.map((tool) => tool.name)).toEqual(['web_search', 'web_research', 'fetch_page']);

    const final = events.filter((event) => event.type === 'assistant_message').at(-1);
    expect(final?.type === 'assistant_message' && final.message.content).toBe(
      'Selon Le Monde, le 28 septembre, le Premier ministre est Sébastien Lecornu.\n\n' +
        'Sources (recherche web du jeudi 1 octobre 2026, 21:30) :\n' +
        '- [1] Budget 2027 : Sébastien Lecornu alerte — Le Monde.fr (lemonde.fr), 28 sept. 2026 — https://www.lemonde.fr/politique/budget',
    );
    const streamed = events.flatMap((event) => (event.type === 'assistant_delta' ? [event.delta] : [])).join('');
    expect(streamed).toContain('Sources (recherche web du');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('recherche sans résultat : le dit clairement, sans appeler le modèle', async () => {
    const provider = new ScriptedProvider([answer('Le Premier ministre est Élisabeth Borne.')]);
    const { manager } = catalogue({ sources: false });
    const events = await run(agentWith(provider, manager), 'Qui est le Premier ministre actuel en France ?');
    expect(provider.requests).toHaveLength(0);
    const final = events.filter((event) => event.type === 'assistant_message').at(-1);
    const text = final?.type === 'assistant_message' ? final.message.content : '';
    expect(text).toMatch(/^Je n'ai pas pu faire la recherche sur Internet/);
    expect(text).toMatch(/ne pas répondre de mémoire/);
    expect(text).toContain('Google Actualités (RSS, sans clé) : fetch failed');
    expect(text).not.toContain('Borne');
  });

  it('outil en panne : même réponse d’échec, avec le message de l’outil', async () => {
    const provider = new ScriptedProvider([answer('de mémoire')]);
    const { manager } = catalogue({ throws: true });
    const events = await run(agentWith(provider, manager), 'Quel est le prix du litre de SP95 aujourd’hui ?');
    expect(provider.requests).toHaveLength(0);
    const final = events.filter((event) => event.type === 'assistant_message').at(-1);
    expect(final?.type === 'assistant_message' && final.message.content).toMatch(/Je n'ai pas pu faire la recherche/);
  });

  it('question contestée : web_research (2 à 4 requêtes) en plus de la recherche datée', async () => {
    const provider = new ScriptedProvider([answer('Selon Le Monde…')]);
    const { manager, calls } = catalogue();
    await run(agentWith(provider, manager), 'Est-ce vrai que le prix de l’essence va baisser cette semaine ?');
    expect(calls.map((call) => call.name)).toEqual([CURRENT_INFO_TOOL_NAME, 'web_research']);
    const queries = (calls[1]?.args as { queries: string[] }).queries;
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.length).toBeLessThanOrEqual(4);
  });

  it('réponse vide du modèle : une phrase honnête puis les sources', async () => {
    const provider = new ScriptedProvider([[{ type: 'done', finishReason: 'stop' }]]);
    const { manager } = catalogue();
    const events = await run(agentWith(provider, manager), 'Qui est le Premier ministre actuel en France ?');
    const final = events.filter((event) => event.type === 'assistant_message').at(-1);
    const text = final?.type === 'assistant_message' ? final.message.content : '';
    expect(text).toMatch(/^Voici ce que la recherche a trouvé/);
    expect(text).toContain('https://www.lemonde.fr/politique/budget');
  });
});

describe('Agent — Google Workspace et recherche d’actualité', () => {
  function withGoogle() {
    const { manager, calls } = catalogue();
    manager.registerAll([
      defineTool({
        name: 'google_calendar_list',
        description: 'agenda',
        risk: 'safe',
        isAvailable: () => true,
        schema: z.object({}).passthrough(),
        execute: async () => (calls.push({ name: 'google_calendar_list', args: {} }), { ok: true, content: 'Demain : 10:00 Réunion.' }),
      }),
      defineTool({
        name: 'google_gmail_search',
        description: 'mails',
        risk: 'safe',
        isAvailable: () => true,
        schema: z.object({}).passthrough(),
        execute: async () => ({ ok: true, content: 'Aucun mail.' }),
      }),
    ]);
    return { manager, calls };
  }

  it.each([
    'Lis mes derniers mails',
    'Qu’est-ce que j’ai à l’agenda demain ?',
    'Quels événements sont prévus dans l’agenda cette semaine ?',
    'Ai-je reçu des e-mails aujourd’hui ?',
    'Quel est le prochain rendez-vous ?',
    'Quelles réunions aujourd’hui ?',
    'Cherche le rapport dans Google Drive',
    'Quelles sont les dernières lignes de la feuille de calcul budget ?',
  ])('« %s » : outils Google proposés, aucune recherche web forcée', async (prompt) => {
    const provider = new ScriptedProvider([answer('ok')]);
    const { manager, calls } = withGoogle();
    await run(agentWith(provider, manager), prompt);
    expect(calls.map((call) => call.name)).not.toContain(CURRENT_INFO_TOOL_NAME);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toContain('google_calendar_list');
    expect(provider.requests[0]?.system).not.toContain('PROTOCOLE ACTUALITÉ');
  });

  it('un suivi « Et demain ? » après un outil Google reste un tour Google', async () => {
    const provider = new ScriptedProvider([answer('ok')]);
    const { manager, calls } = withGoogle();
    const history = [
      createMessage('user', 'Qu’est-ce que j’ai aujourd’hui ?'),
      createMessage('assistant', '', { toolCalls: [{ id: 'g', name: 'google_calendar_list', arguments: {} }] }),
      createMessage('tool', 'Rien.', { toolCallId: 'g', toolName: 'google_calendar_list', toolStatus: 'ok' }),
      createMessage('assistant', 'Rien aujourd’hui.'),
      createMessage('user', 'Et demain ?'),
    ];
    for await (const _event of agentWith(provider, manager).run(history, { requestConfirmation: async () => true })) {
      // vide
    }
    expect(calls).toEqual([]);
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toContain('google_calendar_list');
  });

  it('compte Google connecté : une question d’actualité part sur le web, sans outils Google dans ce tour', async () => {
    const provider = new ScriptedProvider([answer('Selon Le Monde, Sébastien Lecornu.')]);
    const { manager, calls } = withGoogle();
    await run(agentWith(provider, manager), 'Qui est le Premier ministre actuel en France ?');
    expect(calls.map((call) => call.name)).toEqual([CURRENT_INFO_TOOL_NAME]);
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['web_search', 'web_research', 'fetch_page']);
    expect(provider.requests[0]?.system).not.toContain('GOOGLE :');
  });
});

describe('Agent — ce qui ne change pas', () => {
  it('« Quelle heure est-il ? » : pas de recherche, prompt et catalogue identiques à avant', async () => {
    const provider = new ScriptedProvider([answer('Il est 21 h 30.')]);
    const { manager, calls } = catalogue();
    await run(agentWith(provider, manager), 'Quelle heure est-il ?');
    expect(calls).toEqual([]);
    expect(provider.requests[0]?.system).toBe(composeSystemPrompt(BASE, false, false, false));
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      'web_search',
      'web_research',
      'fetch_page',
      'get_system_info',
    ]);
  });

  it('Spotify reste forcé sur spotify_current_track, sans recherche web', async () => {
    const provider = new ScriptedProvider([]);
    const { manager, calls } = catalogue();
    const events = await run(agentWith(provider, manager), 'Qu’est-ce qui joue sur Spotify en ce moment ?');
    expect(calls.map((call) => call.name)).toEqual(['spotify_current_track']);
    expect(provider.requests).toHaveLength(0);
    const final = events.filter((event) => event.type === 'assistant_message').at(-1);
    expect(final?.type === 'assistant_message' && final.message.content).toBe('Lecture : On verra — Nekfeu');
  });

  it('l’outil interne n’est jamais dans le catalogue du modèle', async () => {
    const { manager } = catalogue();
    expect(manager.schemas().map((tool) => tool.name)).not.toContain(CURRENT_INFO_TOOL_NAME);
    expect(manager.get(CURRENT_INFO_TOOL_NAME)?.internal).toBe(true);
  });

  it('sans l’outil interne enregistré : ancien comportement à l’identique (protocole recherche, pas de date)', async () => {
    const provider = new ScriptedProvider([answer('ok')]);
    const manager = new ToolManager().register(
      defineTool({ name: 'web_search', description: 'web', risk: 'safe', schema: z.object({ query: z.string() }), execute: async () => ({ ok: true, content: 'r' }) }),
    );
    await run(agentWith(provider, manager), 'Quelles sont les actualités aujourd’hui ?');
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.system).toBe(composeSystemPrompt(BASE, false, true, false));
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['web_search']);
  });

  it('un tour qui a déjà un résultat d’outil ne relance pas la recherche forcée', async () => {
    const provider = new ScriptedProvider([answer('suite')]);
    const { manager, calls } = catalogue();
    const history = [
      createMessage('user', 'Qui est le Premier ministre actuel en France ?'),
      createMessage('assistant', '', { toolCalls: [{ id: 'x', name: 'web_search', arguments: { query: 'pm' } }] }),
      createMessage('tool', 'résultat', { toolCallId: 'x', toolName: 'web_search', toolStatus: 'ok' }),
    ];
    for await (const _event of agentWith(provider, manager).run(history, { requestConfirmation: async () => true })) {
      // vide
    }
    expect(calls).toEqual([]);
  });
});
