import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITEBLOCK_BASE_URL, type Settings } from '@jarvis/core';
import { SiteBlockBridge, type SiteBlockStatus } from './SiteBlockBridge.js';

function settingsWith(partial: Partial<Settings> = {}): () => Settings {
  return () =>
    ({
      siteBlockBaseUrl: DEFAULT_SITEBLOCK_BASE_URL,
      siteBlockToken: '',
      ...partial,
    }) as Settings;
}

function okStatus(overrides: Partial<SiteBlockStatus> = {}): SiteBlockStatus {
  return {
    ok: true,
    blockingEnabled: true,
    blockingActiveNow: true,
    status: 'active',
    enforcement: 'hosts',
    domains: ['instagram.com'],
    periods: [],
    focus: { active: false, until: null },
    lockout: { active: false, until: null, minutes: 0 },
    ...overrides,
  };
}

describe('SiteBlockBridge', () => {
  const dirs: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
    delete process.env.SITEBLOCK_TOKEN;
    delete process.env.SITEBLOCK_BASE_URL;
  });

  function tempDescriptor(contents: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-siteblock-'));
    dirs.push(dir);
    const path = join(dir, 'api.json');
    writeFileSync(path, JSON.stringify(contents));
    return path;
  }

  it('ne lit jamais process.env pour le jeton ou l’URL', async () => {
    process.env.SITEBLOCK_TOKEN = 'from-env';
    process.env.SITEBLOCK_BASE_URL = 'http://evil.example';
    const fetchMock = vi.fn();
    const bridge = new SiteBlockBridge(settingsWith(), { fetch: fetchMock });

    await expect(bridge.status()).rejects.toThrow(/n’est pas configuré/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('utilise le jeton et l’URL des réglages', async () => {
    const payload = okStatus();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const bridge = new SiteBlockBridge(
      settingsWith({
        siteBlockBaseUrl: 'http://127.0.0.1:19001',
        siteBlockToken: 'settings-token',
      }),
      { fetch: fetchMock },
    );

    await expect(bridge.status()).resolves.toMatchObject({ blockingActiveNow: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:19001/status',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer settings-token' }),
      }),
    );
  });

  it('refuse une URL qui n’est pas en loopback', async () => {
    const fetchMock = vi.fn();
    const bridge = new SiteBlockBridge(
      settingsWith({
        siteBlockBaseUrl: 'https://example.com',
        siteBlockToken: 'token',
      }),
      { fetch: fetchMock },
    );

    await expect(bridge.status()).rejects.toThrow(/rester en local/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reprend l’URL et le jeton de api.json si les réglages sont vides', async () => {
    const path = tempDescriptor({
      baseUrl: 'http://127.0.0.1:19002',
      port: 19002,
      token: 'file-token',
    });
    const payload = okStatus({ blockingActiveNow: false });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const bridge = new SiteBlockBridge(settingsWith(), {
      descriptorPath: path,
      fetch: fetchMock,
    });

    await expect(bridge.status()).resolves.toMatchObject({ blockingActiveNow: false });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:19002/status',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer file-token' }),
      }),
    );
  });

  it('signale non configuré sans jeton et sans api.json', async () => {
    const bridge = new SiteBlockBridge(settingsWith(), {
      descriptorPath: join(tmpdir(), 'jarvis-siteblock-missing', 'api.json'),
      fetch: vi.fn(),
    });
    await expect(bridge.connectionStatus()).resolves.toMatchObject({
      configured: false,
      reachable: false,
    });
  });
});
