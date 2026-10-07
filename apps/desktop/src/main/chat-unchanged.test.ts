import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';

/**
 * Chat, prompts et `run_command` figés sur 0.4.22 : les fichiers de
 * `__golden__/chat-0.4.22/` ont été produits par ce test sur l'arbre 0.4.22
 * (JARVIS_WRITE_GOLDEN=1). Mode Développeur coupé ou activé, le modèle doit
 * recevoir exactement la même chose.
 */
const userData = mkdtempSync(join(tmpdir(), 'jarvis-unchanged-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '0.4.22', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { createToolManager } = await import('./tools/index.js');
const { runCommandTool } = await import('./tools/shell.js');
const { ChatSession } = await import('./session.js');
const { SpotifyBridge } = await import('./media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('./siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('./personalization.js');
const { KnowledgeStore } = await import('./knowledge.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

const GOLDEN_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '__golden__', 'chat-0.4.22');

function golden(name: string, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const file = join(GOLDEN_DIR, `${name}.json`);
  if (process.env.JARVIS_WRITE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

const BASE = { provider: 'ollama', model: 'qwen2.5:3b' };
const VARIANTS = {
  'mode développeur absent ou coupé': core.parseSettings(BASE),
  'mode développeur activé': core.parseSettings({
    ...BASE,
    developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis' },
  }),
};

function chatTools(settings: ReturnType<typeof core.parseSettings>) {
  const getSettings = () => settings;
  return createToolManager({
    getSettings,
    searchRegistry: core.createDefaultSearchRegistry(),
    marketDataRegistry: core.createDefaultMarketDataRegistry(),
    spotify: new SpotifyBridge(getSettings),
    siteBlock: new SiteBlockBridge(getSettings),
    personalization: new PersonalizationStore(),
    knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
  });
}

interface CapturedRequest {
  system?: string;
  messages: Array<{ role: string; content: string }>;
  tools: string[];
  temperature?: number;
}

function capturingRegistry(requests: CapturedRequest[]) {
  return new core.ProviderRegistry().register({ ...core.ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request) {
      requests.push({
        system: request.system,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        tools: (request.tools ?? []).map((tool) => tool.name),
        temperature: request.temperature,
      });
      yield { type: 'text' as const, delta: 'Très bien.' };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
}

const TURNS: Array<{ text: string; source?: 'voice' | 'text' }> = [
  { text: 'Bonjour Jarvis, comment vas-tu ?' },
  { text: 'Quelle heure est-il ?', source: 'voice' },
  { text: 'Ouvre le Bloc-notes.' },
  { text: "Qu'est-ce que j'ai demain dans mon agenda ?" },
  { text: 'Lis le fichier C:\\Users\\dex\\notes.txt' },
  { text: 'Mets Daft Punk sur Spotify' },
];

async function chatTurns(settings: ReturnType<typeof core.parseSettings>) {
  const turns = [];
  for (const turn of TURNS) {
    const requests: CapturedRequest[] = [];
    const events: ChatEvent[] = [];
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, event: ChatEvent) => events.push(event),
    } as unknown as Electron.WebContents;
    const session = new ChatSession({
      registry: capturingRegistry(requests),
      tools: chatTools(settings),
      store: new core.InMemoryConversationStore(),
      auditLog: new core.InMemoryAuditLogStore(),
      getSettings: () => settings,
      voice: { hasApiKey: () => false } as never,
      personalization: { get: async () => core.emptyPersonalization() } as never,
      knowledge: { indexConversation: async () => 0 } as never,
      localLearning: { recordTurn: async () => undefined } as never,
    });
    await session.send(sender, { conversationId: null, text: turn.text, source: turn.source });
    turns.push({
      turn,
      requests,
      events: events.map((event) =>
        event.type === 'started' || event.type === 'done'
          ? { type: event.type }
          : event.type === 'tool_start' || event.type === 'tool_result'
            ? { type: event.type, toolName: event.toolName }
            : event,
      ),
    });
  }
  return turns;
}

function withoutNodePath(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value).split(JSON.stringify(process.execPath).slice(1, -1)).join('<node>'),
  );
}

describe('chat identique à 0.4.22', () => {
  it.each(Object.entries(VARIANTS))(
    '%s : catalogue d’outils envoyé au modèle',
    (_label, settings) => {
      const manager = chatTools(settings);
      golden('catalogue-modele', manager.schemas());
      golden(
        'catalogue-risques',
        manager.list().map((tool) => ({
          name: tool.name,
          risk: tool.risk,
          category: tool.category ?? null,
          forceConfirm: tool.forceConfirm,
          internal: tool.internal === true,
        })),
      );
    },
  );

  it.each(Object.entries(VARIANTS))(
    '%s : requêtes envoyées au modèle (prompts, messages, outils)',
    async (_label, settings) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 2, 10, 0));
      try {
        golden('tours-de-chat', await chatTurns(settings));
      } finally {
        vi.useRealTimers();
      }
    },
    30_000,
  );

  it('réglages par défaut : identiques hors du bloc developer', () => {
    const defaults: Record<string, unknown> = { ...core.parseSettings({}) };
    delete defaults.developer;
    delete defaults.localLearning;
    golden('reglages-par-defaut', defaults);
  });
});

describe('run_command identique à 0.4.22', () => {
  it('schéma, carte de confirmation, refus, politique « jamais » et exécution', async () => {
    const manager = new core.ToolManager().register(runCommandTool);
    const asked: unknown[] = [];
    const call = (
      id: string,
      args: Record<string, unknown>,
      approve: boolean,
      policies?: Record<string, string>,
    ) =>
      manager.execute(
        { id, name: 'run_command', arguments: args },
        {
          ...(policies ? { policies: policies as never } : {}),
          requestConfirmation: async (request) => {
            asked.push(request);
            return approve;
          },
        },
      );
    const outcomes = [
      await call('refus', { command: 'git', args: ['push', '--force'] }, false),
      await call('admin', { command: 'reg', args: ['add', 'HKLM\\X'], elevate: true }, false),
      await call('shell', { command: 'dir | findstr x', useShell: true }, false),
      await call('jamais', { command: 'echo', args: ['ok'] }, false, {
        apps: 'never',
        files: 'never',
        capture: 'never',
        shell: 'never',
      }),
      await call(
        'exec',
        { command: process.execPath, args: ['-e', "process.stdout.write('jarvis')"] },
        true,
      ),
    ].map(({ durationMs: _duration, ...rest }) => rest);
    const [tool] = manager.list();
    golden(
      'run-command',
      withoutNodePath({
        schema: manager.schemas(),
        meta: { risk: tool?.risk, category: tool?.category, forceConfirm: tool?.forceConfirm },
        asked,
        outcomes,
      }),
    );
  }, 30_000);
});
