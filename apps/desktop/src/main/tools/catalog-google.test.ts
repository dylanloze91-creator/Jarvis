import { mkdtempSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-catalog-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '0.4.20', isPackaged: false },
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

function catalog(withGoogle: boolean, fake = new FakeGoogle(), clientId = '') {
  const settings = core.parseSettings({ googleClientId: clientId, googleClientSecret: clientId ? FAKE_CLIENT_SECRET : '' });
  const getSettings = () => settings;
  const google = createGoogleRuntime({
    userDataPath: () => join(userData, clientId ? 'connected' : 'empty'),
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
    searchRegistry: core.createDefaultSearchRegistry(),
    marketDataRegistry: core.createDefaultMarketDataRegistry(),
    spotify: new SpotifyBridge(getSettings),
    siteBlock: new SiteBlockBridge(getSettings),
    personalization: new PersonalizationStore(),
    knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
    ...(withGoogle ? { google } : {}),
  });
  return { manager, google };
}

describe('catalogue complet de Jarvis', () => {
  it('sans compte Google, le modèle voit exactement les outils de 0.4.19', async () => {
    const before = catalog(false).manager.schemas();
    const { manager, google } = catalog(true);
    await google.account.init();
    expect(manager.schemas()).toEqual(before);
    expect(before.some((schema) => schema.name.startsWith('google_'))).toBe(false);
    // Les outils existants gardent leur niveau de risque et leurs confirmations.
    const old = new Map(catalog(false).manager.list().map((tool) => [tool.name, tool]));
    for (const tool of manager.list().filter((entry) => !entry.name.startsWith('google_'))) {
      expect({ risk: tool.risk, category: tool.category, forceConfirm: tool.forceConfirm }).toEqual({
        risk: old.get(tool.name)?.risk,
        category: old.get(tool.name)?.category,
        forceConfirm: old.get(tool.name)?.forceConfirm,
      });
    }
  });

  it('une fois connecté, les 16 outils Google s’ajoutent sans rien retirer', async () => {
    const before = catalog(false).manager.schemas().map((schema) => schema.name);
    const { manager, google } = catalog(true, new FakeGoogle(), FAKE_CLIENT_ID);
    const result = await google.account.connect();
    expect(result.ok).toBe(true);
    const after = manager.schemas().map((schema) => schema.name);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toHaveLength(16);
    expect(after.slice(before.length).every((name) => name.startsWith('google_'))).toBe(true);
  });
});
