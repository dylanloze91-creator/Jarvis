import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../../shared/ipc.js';

/**
 * Le carnet reste dans userData/carnet. Phrases synthétiques marquées synthetique-test.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-carnet-file-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.76', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { createToolManager } = await import('../tools/index.js');
const { ChatSession } = await import('../session.js');
const { SpotifyBridge } = await import('../media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('../siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('../personalization.js');
const { KnowledgeStore } = await import('../knowledge.js');
const { CarnetFile } = await import('./file.js');
const { CarnetHub } = await import('./hub.js');

afterAll(() => rmSync(userData, { recursive: true, force: true, maxRetries: 5 }));

describe('carnet — rates.jsonl (synthetique-test)', () => {
  it('synthetique-test le fichier est dans userData/carnet et les secrets sont masqués', async () => {
    const file = new CarnetFile(() => userData);
    expect(file.ratesFile().replaceAll('\\', '/')).toBe(
      `${userData.replaceAll('\\', '/')}/carnet/rates.jsonl`,
    );
    const hub = new CarnetHub('test', file);
    const settings = core.parseSettings({ provider: 'ollama', model: 'qwen2.5:7b' });
    const getSettings = () => settings;
    const requests: string[] = [];
    const registry = new core.ProviderRegistry().register(
      { ...core.ollamaDescriptor },
      (config) => ({
        id: 'ollama',
        label: 'Ollama',
        model: config.model,
        requiresApiKey: false,
        async *streamChat(request: { messages: Array<{ content: string }> }) {
          requests.push(request.messages.map((message) => message.content).join('\n'));
          yield { type: 'text' as const, delta: 'Pardon.' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
        },
      }),
    );
    const store = new core.InMemoryConversationStore();
    const conversation = core.newConversation([
      core.createMessage('user', 'Quelle heure est-il ?'),
      core.createMessage('assistant', 'Il est 3 heures.'),
    ]);
    await store.save(conversation);
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
      carnet: hub,
    });
    const events: ChatEvent[] = [];
    await session.send(
      {
        isDestroyed: () => false,
        send: (_channel: string, event: ChatEvent) => events.push(event),
      } as never,
      { conversationId: conversation.id, text: 'Non, la clé sk-abc123456789 est fausse' },
    );
    await hub.flush();
    const raw = readFileSync(file.ratesFile(), 'utf8');
    expect(raw).not.toContain('sk-abc123456789');
    expect(raw).toContain('[REDACTED]');
    expect(raw).toContain('correction-classify');
    expect(raw).toContain('Il est 3 heures.');
    expect(events.some((event) => event.type === 'delta' && event.text === 'Pardon.')).toBe(true);
    expect(requests.some((body) => body.includes('Non, la clé'))).toBe(true);
  });
});
