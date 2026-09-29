import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '@jarvis/core';

const openExternalMock = vi.fn(async () => true);
let userDataDir = '';

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  shell: { openExternal: openExternalMock },
}));

const { SpotifyBridge } = await import('./SpotifyBridge.js');

function settingsWith(spotifyClientId: string): () => Settings {
  return () => ({ spotifyClientId }) as Settings;
}

describe('SpotifyBridge', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'jarvis-spotify-bridge-test-'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("signale « non configuré » quand aucun identifiant client n'est renseigné, sans jamais lire process.env", async () => {
    const bridge = new SpotifyBridge(settingsWith(''));
    await expect(bridge.status()).resolves.toEqual({ configured: false, connected: false });
  });

  it("getProvider() lève une erreur explicite tant que Spotify n'est pas configuré", () => {
    const bridge = new SpotifyBridge(settingsWith(''));
    expect(() => bridge.getProvider()).toThrow(/n'est pas configuré/);
  });

  it('connect() renvoie une erreur exploitable, sans planter, sans identifiant client', async () => {
    const bridge = new SpotifyBridge(settingsWith(''));
    await expect(bridge.connect()).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('Identifiant client Spotify manquant'),
    });
  });

  it('status() accepte un identifiant client non encore enregistré (override), comme pour Ollama', async () => {
    const bridge = new SpotifyBridge(settingsWith('')); // rien n'est encore enregistré dans les réglages
    await expect(bridge.status('brouillon-non-enregistre')).resolves.toEqual({
      configured: true,
      connected: false,
    });
  });

  it('réutilise la même instance de fournisseur tant que l’identifiant client ne change pas', () => {
    const bridge = new SpotifyBridge(settingsWith('client-id'));
    expect(bridge.getProvider()).toBe(bridge.getProvider());
  });

  it("disconnect() n'échoue pas quand Spotify n'a jamais été configuré", async () => {
    const bridge = new SpotifyBridge(settingsWith(''));
    await expect(bridge.disconnect()).resolves.toBeUndefined();
  });
});
