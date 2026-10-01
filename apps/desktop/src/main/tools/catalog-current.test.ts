import { mkdtempSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ChatStreamEvent, LLMProvider, ToolManager } from '@jarvis/core';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-catalog-current-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '0.4.21', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { createToolManager } = await import('./index.js');
const { SpotifyBridge } = await import('../media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('../siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('../personalization.js');
const { KnowledgeStore } = await import('../knowledge.js');
const { createGoogleRuntime } = await import('../google/runtime.js');
const { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FakeGoogle, fakeCipher } = await import('../google/fakeGoogle.testkit.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

/** Recherche hors réseau : Google HTML bloqué, Google Actualités répond. */
function offlineSearchRegistry() {
  const fresh = new Date(Date.now() - 86_400_000).toISOString();
  return new core.SearchProviderRegistry()
    .register(core.googleDescriptor, () => ({
      id: 'google',
      label: core.googleDescriptor.label,
      requiresApiKey: false,
      async search() {
        throw new core.SearchProviderError('Google a renvoyé une page sans résultats exploitables.');
      },
    }))
    .register(core.googleNewsDescriptor, () => ({
      id: 'google-news',
      label: core.googleNewsDescriptor.label,
      requiresApiKey: false,
      async search() {
        return {
          providerId: 'google-news',
          results: [
            {
              title: 'Budget : Sébastien Lecornu alerte',
              url: 'https://news.google.com/rss/articles/abc',
              snippet: '',
              source: 'lemonde.fr',
              publisher: 'Le Monde.fr',
              publishedAt: fresh,
            },
          ],
        };
      },
    }));
}

async function connectedCatalog() {
  const fake = new FakeGoogle();
  const settings = core.parseSettings({ googleClientId: FAKE_CLIENT_ID, googleClientSecret: FAKE_CLIENT_SECRET });
  const getSettings = () => settings;
  const google = createGoogleRuntime({
    userDataPath: () => join(userData, 'connected'),
    cipher: fakeCipher,
    fetch: fake.fetch,
    openExternal: async (url) => {
      setTimeout(() => httpGet(fake.consent(url), (response) => response.resume()), 5);
    },
    getSettings,
    oauthPort: 0,
  });
  const manager = createToolManager({
    getSettings,
    searchRegistry: offlineSearchRegistry(),
    marketDataRegistry: core.createDefaultMarketDataRegistry(),
    spotify: new SpotifyBridge(getSettings),
    siteBlock: new SiteBlockBridge(getSettings),
    personalization: new PersonalizationStore(),
    knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
    google,
  });
  const result = await google.account.connect();
  expect(result.ok).toBe(true);
  return manager;
}

class ScriptedProvider implements LLMProvider {
  readonly id = 'scripted';
  readonly label = 'Scripted';
  readonly model = 'test';
  readonly requiresApiKey = false;
  readonly requests: ChatRequest[] = [];

  constructor(private readonly text: string) {}

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    this.requests.push(request);
    yield { type: 'text', delta: this.text };
    yield { type: 'done', finishReason: 'stop' };
  }
}

async function ask(manager: ToolManager, prompt: string) {
  const provider = new ScriptedProvider('Selon Le Monde, Sébastien Lecornu.');
  const agent = new core.Agent(provider, manager, { systemPrompt: core.DEFAULT_SYSTEM_PROMPT });
  const started: string[] = [];
  for await (const event of agent.run([core.createMessage('user', prompt)], { requestConfirmation: async () => true })) {
    if (event.type === 'tool_start') started.push(event.call.name);
  }
  return { provider, started };
}

describe('catalogue complet : Google Workspace et recherche d’actualité ensemble', () => {
  it('l’outil interne web_search_current n’est jamais montré au modèle, compte connecté ou non', async () => {
    const manager = await connectedCatalog();
    const names = manager.schemas().map((schema) => schema.name);
    expect(names.some((name) => name.startsWith('google_'))).toBe(true);
    expect(names).not.toContain(core.CURRENT_INFO_TOOL_NAME);
    expect(manager.get(core.CURRENT_INFO_TOOL_NAME)?.internal).toBe(true);
  });

  it.each([
    'Lis mes derniers mails',
    'Qu’est-ce que j’ai à l’agenda demain ?',
    'Quelles réunions aujourd’hui ?',
    'Cherche le rapport dans Google Drive',
  ])('« %s » : outils Google proposés, pas de recherche web forcée', async (prompt) => {
    const manager = await connectedCatalog();
    const { provider, started } = await ask(manager, prompt);
    expect(started).not.toContain(core.CURRENT_INFO_TOOL_NAME);
    expect(provider.requests[0]?.tools?.some((schema) => schema.name.startsWith('google_'))).toBe(true);
  });

  it('une question d’actualité part sur le web avant le modèle, sans outils Google dans ce tour', async () => {
    const manager = await connectedCatalog();
    const { provider, started } = await ask(manager, 'Qui est le Premier ministre actuel en France ?');
    expect(started[0]).toBe(core.CURRENT_INFO_TOOL_NAME);
    const tools = provider.requests[0]?.tools?.map((schema) => schema.name) ?? [];
    expect(tools).toEqual(['web_search', 'web_research', 'fetch_page']);
    expect(provider.requests[0]?.messages.at(-1)?.content).toContain('Budget : Sébastien Lecornu alerte');
  });
});
