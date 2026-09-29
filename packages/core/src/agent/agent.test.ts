import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent, DEFAULT_SYSTEM_PROMPT, composeSystemPrompt, looksLikeWebResearchIntent, type AgentEvent } from './agent.js';
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
  it('présente Jarvis comme assistant général, pas uniquement musical', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/pas un assistant uniquement musical/i);
    expect(DEFAULT_SYSTEM_PROMPT).toContain('reset_jarvis_personalization');
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(
      /base ta réponse uniquement sur le résultat de l'outil/i,
    );
  });

  it('demande au modèle d’utiliser les outils de personnalisation seulement sur consigne explicite', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('reset_jarvis_personalization');
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/n'enregistre rien sans une demande explicite/i);
  });

  it('demande au modèle d’utiliser les outils SiteBlock sans prétendre un blocage', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('siteblock_');
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/ne prétends jamais avoir modifié le blocage/i);
  });

  it('oriente la recherche web vers web_search sans clé Google obligatoire', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('web_search');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('web_research');
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/google est disponible sans clé api/i);
  });

  it('demande d’interpréter les fautes phonétiques Whisper sans prétendre un réentraînement', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/ouf/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/ne prétends pas avoir été réentraîné/i);
  });

  it('ajoute le protocole recherche seulement pour une intention web explicite', () => {
    expect(looksLikeWebResearchIntent("Quelles sont les actualités aujourd'hui ?")).toBe(true);
    expect(looksLikeWebResearchIntent('Cherche ça sur internet')).toBe(true);
    expect(looksLikeWebResearchIntent('Comment ouvrir Chrome')).toBe(false);
    expect(looksLikeWebResearchIntent('Cherche dans ta mémoire le projet SiteBlock')).toBe(false);
    expect(composeSystemPrompt('Base.', false, true)).toMatch(/PROTOCOLE RECHERCHE/);
    expect(composeSystemPrompt('Base.', true, true)).toMatch(/spotify_\*/);
    expect(composeSystemPrompt('Base.', true, true)).not.toMatch(/PROTOCOLE RECHERCHE/);
  });

  it('oriente la mémoire documentaire vers les outils dédiés, sans dump automatique', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('search_jarvis_memory');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('remember_jarvis');
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(
      /n'affirme jamais qu'une information vient de la mémoire/i,
    );
  });

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

  it('garde le refus sur le message outil, pour l’historique', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'delete_file', arguments: { path: '/a' } } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
    ]);
    const deleteFile = defineTool({
      name: 'delete_file',
      description: 'Corbeille.',
      risk: 'confirm',
      category: 'files',
      forceConfirm: true,
      schema: z.object({ path: z.string() }),
      execute: async () => ({ ok: true, content: 'supprimé' }),
    });
    const agent = new Agent(provider, new ToolManager().register(deleteFile), {
      systemPrompt: 'test',
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.run([createMessage('user', 'supprime /a')], {
      requestConfirmation: async () => false,
    })) {
      events.push(event);
    }
    const result = events.find((e) => e.type === 'tool_result');
    expect(result?.type === 'tool_result' && result.message.toolStatus).toBe('denied');
  });

  it('après un refus, répond sans relancer le modèle (qui prétendait l’action faite)', async () => {
    const provider = new ScriptedProvider([
      [
        {
          type: 'tool_call',
          call: { id: 'c1', name: 'create_folder', arguments: { name: 'Rapport audit' } },
        },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', delta: 'Le dossier "Rapport audit" a été créé dans vos Documents.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const createFolder = defineTool({
      name: 'create_folder',
      description: 'Crée un dossier.',
      risk: 'confirm',
      category: 'files',
      schema: z.object({ name: z.string() }),
      execute: async () => ({ ok: true, content: 'créé' }),
    });
    const agent = new Agent(provider, new ToolManager().register(createFolder), {
      systemPrompt: 'test',
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.run([createMessage('user', 'Crée un dossier Rapport audit')], {
      requestConfirmation: async () => false,
    })) {
      events.push(event);
    }
    const reply = events
      .filter((e) => e.type === 'assistant_delta')
      .map((e) => e.delta)
      .join('');

    expect(provider.requests).toHaveLength(1);
    expect(reply).toBe(
      "D'accord, je n'ai rien fait : tu as refusé « create_folder ». Rien n'a été modifié.",
    );
    expect(reply).not.toMatch(/a été créé/);
    expect(events.at(-1)).toEqual({ type: 'done' });
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

  it('force spotify_play avant le modèle pour « écouter On Verra de Nekfeu »', async () => {
    const play = defineTool({
      name: 'spotify_play',
      description: 'Lecture Spotify.',
      risk: 'safe',
      schema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({
        ok: true,
        content: `Lecture lancée sur Spotify : ${query}.`,
      }),
    });
    const provider = new ScriptedProvider([
      [
        { type: 'text', delta: 'Je n’ai pas réussi à trouver Necfeu.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const agent = new Agent(provider, new ToolManager().register(play), { systemPrompt: 'test' });

    const events = await collect(agent, 'écouter On Verra de Nekfeu');
    const start = events.find((event) => event.type === 'tool_start');
    const reply = events
      .filter((event) => event.type === 'assistant_delta')
      .map((event) => event.delta);

    expect(start?.call.name).toBe('spotify_play');
    expect(start?.call.arguments).toEqual({ query: 'On Verra de Nekfeu' });
    expect(provider.requests).toHaveLength(0);
    expect(reply.join('')).toContain('Lecture lancée sur Spotify');
    expect(reply.join('')).not.toContain('Necfeu');
  });

  it('après une lecture, un autre sujet n’appelle pas Spotify et n’expose pas les outils musicaux', async () => {
    const play = defineTool({
      name: 'spotify_play',
      description: 'Lecture Spotify.',
      risk: 'safe',
      schema: z.object({ query: z.string() }),
      execute: async () => ({ ok: true, content: 'Lecture lancée.' }),
    });
    const provider = new ScriptedProvider([
      [
        { type: 'text', delta: 'Il est 21 heures.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const agent = new Agent(provider, new ToolManager().register(play).register(systemInfo), {
      systemPrompt: DEFAULT_SYSTEM_PROMPT + '\n--- MÉMOIRE DE PERSONNALISATION JARVIS ---\n',
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.run(
      [
        createMessage('user', 'écouter On Verra de Nekfeu'),
        createMessage('assistant', 'Lecture lancée sur Spotify : On Verra.'),
        createMessage('user', 'quelle heure est-il ?'),
      ],
      { requestConfirmation: async () => true },
    )) {
      events.push(event);
    }

    expect(events.find((event) => event.type === 'tool_start')).toBeUndefined();
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['get_system_info']);
    expect(provider.requests[0]?.system).toContain('MÉMOIRE DE PERSONNALISATION');
    expect(provider.requests[0]?.system).not.toMatch(/spotify_play/);
    expect(provider.requests[0]?.system).toMatch(/pas un assistant uniquement musical/i);
  });

  it('sur une demande musicale, ajoute la consigne Spotify et expose les outils musicaux', async () => {
    const play = defineTool({
      name: 'spotify_play',
      description: 'Lecture Spotify.',
      risk: 'safe',
      schema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ ok: true, content: `Lecture : ${query}` }),
    });
    const provider = new ScriptedProvider([]);
    const agent = new Agent(provider, new ToolManager().register(play), {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    });

    await collect(agent, 'écouter On Verra de Nekfeu');
    expect(provider.requests).toHaveLength(0);
  });

  it('force youtube_transcript depuis le dernier message, avec la progression, sans le modèle du chat', async () => {
    const transcript = defineTool({
      name: 'youtube_transcript',
      description: 'Écoute YouTube.',
      risk: 'safe',
      schema: z.object({ url: z.string() }),
      execute: async ({ url }, context) => {
        context.onProgress?.('Téléchargement de la piste audio…');
        context.onProgress?.('Écoute de la vidéo, partie 1 sur 1…');
        return { ok: true, content: `Condensé de ${url} : le CAC est à 7200.` };
      },
    });
    const provider = new ScriptedProvider([
      [
        { type: 'text', delta: 'Je connais déjà cette vidéo.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const agent = new Agent(provider, new ToolManager().register(transcript), { systemPrompt: 'test' });

    const events = await collect(agent, 'Résume https://youtu.be/dQw4w9WgXcQ');
    const start = events.find((event) => event.type === 'tool_start');
    const progress = events
      .filter((event) => event.type === 'tool_progress')
      .map((event) => event.message);
    const reply = events
      .filter((event) => event.type === 'assistant_delta')
      .map((event) => event.delta)
      .join('');

    expect(start?.call.name).toBe('youtube_transcript');
    expect(start?.call.arguments).toEqual({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(progress).toContain('Téléchargement de la piste audio…');
    expect(provider.requests).toHaveLength(0);
    expect(reply).toContain('7200');
    expect(reply).not.toContain('Je connais déjà');
  });

  it('un lien YouTube plus ancien ne force pas l’outil', async () => {
    const transcript = defineTool({
      name: 'youtube_transcript',
      description: 'Écoute YouTube.',
      risk: 'safe',
      schema: z.object({ url: z.string() }),
      execute: async () => ({ ok: true, content: 'Condensé.' }),
    });
    const provider = new ScriptedProvider([
      [
        { type: 'text', delta: 'Il est midi.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const agent = new Agent(provider, new ToolManager().register(transcript).register(systemInfo), {
      systemPrompt: 'test',
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.run(
      [
        createMessage('user', 'Résume https://youtu.be/dQw4w9WgXcQ'),
        createMessage('assistant', 'Condensé.'),
        createMessage('user', 'quelle heure est-il ?'),
      ],
      { requestConfirmation: async () => true },
    )) {
      events.push(event);
    }

    expect(events.find((event) => event.type === 'tool_start')).toBeUndefined();
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.system).not.toMatch(/youtube_transcript/);
  });

  it('ajoute la consigne de condensé YouTube seulement pour un lien', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('youtube_transcript');
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/n'invente aucun chiffre/i);
    expect(composeSystemPrompt('Base.', true, true, true)).toMatch(/condensé/i);
    expect(composeSystemPrompt('Base.', true, true, true)).not.toMatch(/spotify_\*/);
    expect(composeSystemPrompt('Base.', true, true)).toMatch(/spotify_\*/);
  });

  describe('morceau en cours Spotify', () => {
    const WMIC_ANSWER =
      "Je ne peux pas voir Spotify. Lance `wmic process where name='Spotify.exe'` en administrateur.";

    const currentTrackTool = (result: { ok: boolean; content: string }) =>
      defineTool({
        name: 'spotify_current_track',
        description: 'Morceau Spotify en cours.',
        risk: 'safe',
        schema: z.object({}),
        execute: async () => result,
      });

    const playTool = defineTool({
      name: 'spotify_play',
      description: 'Lecture Spotify.',
      risk: 'safe',
      schema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({
        ok: true,
        content: `Lecture lancée sur Spotify : ${query}.`,
      }),
    });

    const wmicProvider = () =>
      new ScriptedProvider([
        [
          { type: 'text', delta: WMIC_ANSWER },
          { type: 'done', finishReason: 'stop' },
        ],
      ]);

    const replyOf = (events: AgentEvent[]) =>
      events
        .filter((event) => event.type === 'assistant_delta')
        .map((event) => event.delta)
        .join('');

    it('force spotify_current_track pour « Que joue Spotify en ce moment ? » et répond avec le titre et l’artiste', async () => {
      const provider = wmicProvider();
      const tools = new ToolManager()
        .register(playTool)
        .register(
          currentTrackTool({
            ok: true,
            content: 'Lecture : Trop beau — Lomepal sur Ordinateur de bureau.',
          }),
        );
      const agent = new Agent(provider, tools, { systemPrompt: DEFAULT_SYSTEM_PROMPT });

      const events = await collect(agent, 'Que joue Spotify en ce moment ?');
      const starts = events.filter((event) => event.type === 'tool_start');
      const reply = replyOf(events);

      expect(starts.map((event) => event.call.name)).toEqual(['spotify_current_track']);
      expect(starts[0]?.call.arguments).toEqual({});
      expect(provider.requests).toHaveLength(0);
      expect(reply).toContain('Trop beau');
      expect(reply).toContain('Lomepal');
      expect(reply).not.toMatch(/wmic|administrateur|powershell/i);
      expect(events.at(-1)).toEqual({ type: 'done' });
    });

    it.each([
      "Qu'est-ce qui passe ?",
      "C'est quoi cette musique ?",
      'Quel est ce morceau ?',
      "C'est qui qui chante ?",
      'Quelle musique tourne ?',
      "Qu'est-ce qu'il passe sur Spotifaï ?",
    ])('force aussi spotify_current_track pour « %s »', async (prompt) => {
      const provider = wmicProvider();
      const tools = new ToolManager()
        .register(playTool)
        .register(currentTrackTool({ ok: true, content: 'Lecture : Trop beau — Lomepal.' }));
      const agent = new Agent(provider, tools, { systemPrompt: 'test' });

      const events = await collect(agent, prompt);

      expect(events.find((event) => event.type === 'tool_start')?.call.name).toBe(
        'spotify_current_track',
      );
      expect(provider.requests).toHaveLength(0);
      expect(replyOf(events)).toBe('Lecture : Trop beau — Lomepal.');
    });

    it('en cas d’échec, répond avec l’erreur française de l’outil, sans commande shell', async () => {
      const provider = wmicProvider();
      const tools = new ToolManager().register(
        currentTrackTool({
          ok: false,
          content:
            "Spotify : Spotify n'est pas connecté. Clique sur « Se connecter » dans les réglages, section Musique.",
        }),
      );
      const agent = new Agent(provider, tools, { systemPrompt: DEFAULT_SYSTEM_PROMPT });

      const events = await collect(agent, 'Que joue Spotify en ce moment ?');
      const result = events.find((event) => event.type === 'tool_result');
      const reply = replyOf(events);

      expect(result?.type === 'tool_result' && result.message.toolStatus).toBe('error');
      expect(provider.requests).toHaveLength(0);
      expect(reply).toBe(
        "Je n'ai pas pu savoir ce qui joue sur Spotify : Spotify n'est pas connecté. Clique sur « Se connecter » dans les réglages, section Musique.",
      );
      expect(reply).not.toMatch(/wmic|administrateur|powershell/i);
    });

    it('quand rien ne joue, répète le message de l’outil', async () => {
      const tools = new ToolManager().register(
        currentTrackTool({
          ok: true,
          content: 'Aucun morceau Spotify n’est actuellement en lecture.',
        }),
      );
      const agent = new Agent(wmicProvider(), tools, { systemPrompt: 'test' });

      const reply = replyOf(await collect(agent, "C'est quoi cette musique ?"));

      expect(reply).toBe('Aucun morceau Spotify n’est actuellement en lecture.');
    });

    it('sépare lecture et morceau en cours : « joue du Nekfeu » et « lance lomepal sur spotify » restent spotify_play', async () => {
      const tools = new ToolManager()
        .register(playTool)
        .register(currentTrackTool({ ok: true, content: 'Lecture : Trop beau — Lomepal.' }));

      for (const [prompt, query] of [
        ['joue du Nekfeu', 'du Nekfeu'],
        ['lance lomepal sur spotify', 'lomepal'],
      ] as const) {
        const provider = wmicProvider();
        const agent = new Agent(provider, tools, { systemPrompt: 'test' });
        const starts = (await collect(agent, prompt)).filter(
          (event) => event.type === 'tool_start',
        );

        expect(starts.map((event) => event.call.name)).toEqual(['spotify_play']);
        expect(starts[0]?.call.arguments).toEqual({ query });
        expect(provider.requests).toHaveLength(0);
      }
    });

    it('seul le dernier message compte : une ancienne question sur la musique ne force rien', async () => {
      const provider = new ScriptedProvider([
        [
          { type: 'text', delta: 'Il est 21 heures.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ]);
      const tools = new ToolManager()
        .register(currentTrackTool({ ok: true, content: 'Lecture : Trop beau — Lomepal.' }))
        .register(systemInfo);
      const agent = new Agent(provider, tools, { systemPrompt: 'test' });

      const events: AgentEvent[] = [];
      for await (const event of agent.run(
        [
          createMessage('user', "C'est quoi cette musique ?"),
          createMessage('assistant', 'Lecture : Trop beau — Lomepal.'),
          createMessage('user', 'quelle heure est-il ?'),
        ],
        { requestConfirmation: async () => true },
      )) {
        events.push(event);
      }

      expect(events.find((event) => event.type === 'tool_start')).toBeUndefined();
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['get_system_info']);
    });

    it('une question générale sur la musique passe au modèle, sans outils Spotify', async () => {
      const provider = new ScriptedProvider([
        [
          { type: 'text', delta: 'C’est Queen.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ]);
      const tools = new ToolManager()
        .register(playTool)
        .register(currentTrackTool({ ok: true, content: 'Lecture : Trop beau — Lomepal.' }))
        .register(systemInfo);
      const agent = new Agent(provider, tools, { systemPrompt: 'test' });

      const events = await collect(agent, 'Qui chante Bohemian Rhapsody ?');

      expect(events.find((event) => event.type === 'tool_start')).toBeUndefined();
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['get_system_info']);
    });

    it('sans spotify_current_track enregistré, le modèle reçoit la consigne et jamais de spotify_play forcé', async () => {
      const provider = new ScriptedProvider([
        [
          { type: 'text', delta: 'Spotify ne répond pas.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ]);
      const agent = new Agent(provider, new ToolManager().register(playTool), {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
      });

      const events = await collect(agent, "Qu'est-ce qui joue sur Spotify ?");

      expect(events.find((event) => event.type === 'tool_start')).toBeUndefined();
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['spotify_play']);
      expect(provider.requests[0]?.system).toContain('spotify_current_track');
      expect(provider.requests[0]?.system).toMatch(
        /ne propose jamais de commande shell, PowerShell ou wmic/i,
      );
    });
  });
});
