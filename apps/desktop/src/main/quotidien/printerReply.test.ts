import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../../shared/ipc.js';

/**
 * Imprimante éteinte : la phrase reste ici, le modèle n'est pas appelé.
 * synthetique-test.
 */
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/jarvis-printer-reply', getVersion: () => '5.0.76', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { FakeMoonraker } = await import('../../../../../packages/core/src/quotidien/fakeMoonraker.testkit.js');
const { PRINTER_CANCEL_SILENT, PRINTER_SILENT, runPrinterReply } = await import('./printerReply.js');
const { createToolManager } = await import('../tools/index.js');
const { ChatSession } = await import('../session.js');
const { SpotifyBridge } = await import('../media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('../siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('../personalization.js');
const { KnowledgeStore } = await import('../knowledge.js');

const settings = core.parseSettings({
  provider: 'ollama',
  model: 'qwen2.5:7b',
  printer: { enabled: true, baseUrl: 'http://printer.local:7125' },
});

function registry(calls: number[]) {
  return new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat() {
      calls.push(1);
      yield { type: 'text' as const, delta: 'le modèle ne doit pas être appelé' };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
}

describe('imprimante éteinte (synthetique-test)', () => {
  it('le faux serveur arrêté répond sans modèle', async () => {
    const fake = new FakeMoonraker();
    fake.stopped = true;
    const calls: number[] = [];
    const store = new core.InMemoryConversationStore();
    const conversation = core.newConversation();
    await store.save(conversation);
    const events: ChatEvent[] = [];
    const session = new ChatSession({
      registry: registry(calls),
      tools: createToolManager({
        getSettings: () => settings,
        searchRegistry: core.createDefaultSearchRegistry(),
        marketDataRegistry: core.createDefaultMarketDataRegistry(),
        spotify: new SpotifyBridge(() => settings),
        siteBlock: new SiteBlockBridge(() => settings),
        personalization: new PersonalizationStore(),
        knowledge: new KnowledgeStore({ getUserDataPath: () => '/tmp/jarvis-printer-reply' }),
      }),
      store,
      auditLog: new core.InMemoryAuditLogStore(),
      getSettings: () => settings,
      voice: { hasApiKey: () => false } as never,
      personalization: { get: async () => core.emptyPersonalization() } as never,
      knowledge: { indexConversation: async () => 0 } as never,
      localLearning: { recordTurn: async () => undefined } as never,
      printer: (input) => runPrinterReply(input, () => new core.MoonrakerClient(settings.printer?.baseUrl ?? '', '', fake.fetch)),
    });
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, event: ChatEvent) => events.push(event),
    } as unknown as Electron.WebContents;

    await session.send(sender, { conversationId: conversation.id, text: "où en est l'impression" });
    await session.send(sender, { conversationId: conversation.id, text: "annule l'impression" });

    expect(calls).toEqual([]);
    expect(events.filter((event) => event.type === 'delta').map((event) => (event.type === 'delta' ? event.text : ''))).toEqual([
      PRINTER_SILENT,
      PRINTER_CANCEL_SILENT,
    ]);
    const saved = await store.get(conversation.id);
    expect(saved?.messages.at(-1)?.content).toBe(PRINTER_CANCEL_SILENT);
  });
});
