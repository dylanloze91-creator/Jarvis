import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * 5.0.63 — le téléphone branché sur une vraie session de chat : réponse en flux, carte de
 * confirmation reçue sur le téléphone, refus envoyé depuis le téléphone (l'outil ne tourne pas),
 * discussion enregistrée et relue.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-phone-session-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.63', isPackaged: false },
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
const { PhoneServer } = await import('./phone/server.js');
const { PhoneStore } = await import('./phone/store.js');

afterAll(() => rmSync(userData, { recursive: true, force: true, maxRetries: 5 }));

function post(port: number, path: string, token: string, body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { Host: 'pc.tail.ts.net', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve(text));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

describe('téléphone + vraie session (5.0.63)', () => {
  it('confirmation affichée et refusée sur le téléphone, discussion relue', async () => {
    const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:7b' });
    const getSettings = () => settings;
    let calls = 0;
    const registry = new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
      id: 'ollama',
      label: 'Ollama',
      model: config.model,
      requiresApiKey: false,
      async *streamChat() {
        calls += 1;
        yield {
          type: 'tool_call' as const,
          call: { id: 'c1', name: 'create_folder', arguments: { name: 'Essai téléphone', location: 'documents' } },
        };
        yield { type: 'done' as const, finishReason: 'tool_calls' as const };
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
    const phoneStore = new PhoneStore(() => join(userData, 'phone.json'));
    const server = new PhoneServer({
      store: phoneStore,
      chat: {
        send: (sender, input) => session.send(sender as unknown as Electron.WebContents, input),
        respondConfirmation: (id, approved) => session.respondConfirmation(id, approved),
        cancel: () => session.cancel(),
      },
      conversation: (id) => store.get(id),
      icon: async () => null,
      version: () => '5.0.63',
    });
    await server.start(0);
    try {
      const port = server.port!;
      const { token } = await phoneStore.addDevice('iPhone');

      const events: ChatEvent[] = [];
      await new Promise<void>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: '/api/chat',
            method: 'POST',
            headers: { Host: 'pc.tail.ts.net', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          },
          (res) => {
            let buffer = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              buffer += chunk;
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines.filter(Boolean)) {
                const event = JSON.parse(line) as ChatEvent;
                events.push(event);
                if (event.type === 'confirm') void post(port, '/api/confirm', token, { requestId: event.requestId, approved: false });
              }
            });
            res.on('end', () => resolve());
          },
        );
        req.on('error', reject);
        req.end(JSON.stringify({ text: 'Crée un dossier Essai téléphone' }));
      });

      const types = events.map((event) => event.type);
      expect(types[0]).toBe('started');
      expect(types).toContain('confirm');
      expect(types.at(-1)).toBe('done');
      const confirm = events.find((event): event is Extract<ChatEvent, { type: 'confirm' }> => event.type === 'confirm');
      expect(confirm?.toolName).toBe('create_folder');
      const result = events.find((event): event is Extract<ChatEvent, { type: 'tool_result' }> => event.type === 'tool_result');
      expect(result?.status).toBe('denied');
      // Tous les appels refusés : texte fixe, le modèle n'est pas relancé (règle 0.4.10).
      expect(calls).toBe(1);

      const started = events[0] as Extract<ChatEvent, { type: 'started' }>;
      const conversation = await store.get(started.conversationId);
      expect(conversation?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    } finally {
      await server.stop();
    }
  });
});
