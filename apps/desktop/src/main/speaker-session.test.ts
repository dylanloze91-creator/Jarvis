import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * 5.0.64 — une enceinte branchée sur une **vraie** session de chat (vrais outils) : une action
 * qui demande confirmation est refusée d'office (l'outil ne tourne pas), Jarvis le dit à voix
 * haute, et la discussion est enregistrée sous le nom de l'enceinte. Une réponse en texte est
 * lue telle quelle, en 16 kHz.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-speaker-session-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.64', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { createToolManager } = await import('./tools/index.js');
const { ChatSession } = await import('./session.js');
const { SpotifyBridge } = await import('./media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('./siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('./personalization.js');
const { KnowledgeStore } = await import('./knowledge.js');
const { SpeakerServer } = await import('./speaker/server.js');
const { SpeakerStore } = await import('./speaker/store.js');

afterAll(() => rmSync(userData, { recursive: true, force: true, maxRetries: 5 }));

function turn(port: number, token: string, wav: Uint8Array): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/speaker/turn',
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(wav.byteLength), Authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end(Buffer.from(wav));
  });
}

function voiceWav(): Uint8Array {
  const samples = Float32Array.from({ length: core.SPEAKER_SAMPLE_RATE }, (_, index) =>
    0.2 * Math.sin((2 * Math.PI * 220 * index) / core.SPEAKER_SAMPLE_RATE),
  );
  return core.encodeWav(samples, core.SPEAKER_SAMPLE_RATE);
}

type Turn = Array<{ type: 'tool_call'; call: { id: string; name: string; arguments: Record<string, unknown> } } | { type: 'text'; delta: string }>;

async function setup(turns: Turn[]) {
  const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:7b' });
  const getSettings = () => settings;
  let calls = 0;
  const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat() {
      const script = turns[Math.min(calls, turns.length - 1)] ?? [];
      calls += 1;
      let toolCalls = false;
      for (const step of script) {
        if (step.type === 'tool_call') toolCalls = true;
        yield step;
      }
      yield { type: 'done' as const, finishReason: toolCalls ? ('tool_calls' as const) : ('stop' as const) };
    },
  }));
  const store = new core.InMemoryConversationStore();
  const session = new ChatSession({
    registry,
    tools: createToolManager({
      getSettings,
      searchRegistry: core.createDefaultSearchRegistry(),
      marketDataRegistry: core.createDefaultMarketDataRegistry(),
      spotify: new SpotifyBridge(getSettings),
      siteBlock: new SiteBlockBridge(getSettings),
      personalization: new PersonalizationStore(),
      knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
    }),
    store,
    auditLog: new core.InMemoryAuditLogStore(),
    getSettings,
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => core.emptyPersonalization() } as never,
    knowledge: { indexConversation: async () => 0 } as never,
    localLearning: { recordTurn: async () => undefined } as never,
  });
  const spoken: string[] = [];
  let transcript = '';
  const speakerStore = new SpeakerStore(() => join(userData, `speakers-${Math.random().toString(36).slice(2)}.json`));
  await speakerStore.load();
  const server = new SpeakerServer({
    store: speakerStore,
    chatFor: () => ({
      send: (sender, input) => session.send(sender as unknown as Electron.WebContents, input),
      respondConfirmation: (id, approved) => session.respondConfirmation(id, approved),
      cancel: () => session.cancel(),
    }),
    transcribe: async () => transcript,
    synthesizer: {
      async synthesize(text) {
        spoken.push(text);
        return core.silenceWav(120);
      },
    },
    voiceSettings: () => settings.voice,
    version: () => '5.0.64',
    conversations: store,
  });
  await server.start(0);
  const { token } = await speakerStore.addSpeaker('Cuisine');
  return {
    server,
    port: server.port!,
    token,
    store,
    spoken,
    calls: () => calls,
    say: (text: string) => {
      transcript = text;
    },
  };
}

describe('enceinte + vraie session (5.0.64)', () => {
  it('une action à confirmer est refusée d’office et dite à voix haute ; discussion titrée du nom de l’enceinte', async () => {
    const ctx = await setup([
      [{ type: 'tool_call', call: { id: 'c1', name: 'create_folder', arguments: { name: 'Essai enceinte', location: 'documents' } } }],
    ]);
    try {
      ctx.say('Jarvis, crée un dossier Essai enceinte');
      const reply = await turn(ctx.port, ctx.token, voiceWav());
      expect(reply.status).toBe(200);
      expect(reply.headers['content-type']).toBe('audio/wav');
      expect(ctx.spoken).toEqual([core.SPEAKER_CONFIRMATION_REFUSAL]);
      // Le modèle n'est pas relancé après un refus (règle 0.4.10) ; l'outil n'a pas tourné.
      expect(ctx.calls()).toBe(1);
      const [conversation] = await ctx.store.list();
      expect(conversation?.title.startsWith('Cuisine · ')).toBe(true);
      const full = await ctx.store.get(conversation!.id);
      expect(full?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
      const toolMessage = full?.messages.find((message) => message.role === 'tool');
      expect(JSON.stringify(toolMessage)).toContain('denied');
    } finally {
      await ctx.server.stop();
    }
  });

  it('une réponse en texte est lue, et la phrase suivante reste dans la même discussion', async () => {
    const ctx = await setup([
      [{ type: 'text', delta: 'Il est ' }, { type: 'text', delta: '**midi**.' }],
      [{ type: 'text', delta: 'Et demain, il fera beau.' }],
    ]);
    try {
      ctx.say('Jarvis, quelle heure est-il');
      const first = await turn(ctx.port, ctx.token, voiceWav());
      expect(first.status).toBe(200);
      expect(core.decodeWav(new Uint8Array(first.body)).sampleRate).toBe(core.SPEAKER_SAMPLE_RATE);
      expect(ctx.spoken).toEqual(['Il est midi.']);

      ctx.say('Jarvis et demain');
      const second = await turn(ctx.port, ctx.token, voiceWav());
      expect(second.status).toBe(200);
      expect(ctx.spoken[1]).toBe('Et demain, il fera beau.');
      const list = await ctx.store.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.title).toBe('Cuisine · quelle heure est-il');
      const full = await ctx.store.get(list[0]!.id);
      expect(full?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    } finally {
      await ctx.server.stop();
    }
  });
});
