import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@jarvis/core';

vi.mock('../media/launchSpotifyDesktop.js', () => ({
  launchSpotifyDesktop: vi.fn(),
  windowsSpotifyExeCandidates: vi.fn(() => []),
}));

const { launchSpotifyDesktop } = await import('../media/launchSpotifyDesktop.js');
const { openApplicationTool } = await import('./applications.js');

function fakeContext(): ToolContext {
  return { requestConfirmation: async () => true };
}

describe('open_application Spotify', () => {
  it('ouvre le client AppData via launchSpotifyDesktop, pas Start-Process Spotify.exe', async () => {
    vi.mocked(launchSpotifyDesktop).mockResolvedValue({
      ok: true,
      detail: String.raw`C:\Users\dex\AppData\Roaming\Spotify\Spotify.exe`,
    });

    const result = await openApplicationTool.run({ name: 'Spotify' }, fakeContext());

    expect(launchSpotifyDesktop).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/Application lancée : Spotify/);
    expect(result.content).toMatch(/AppData\\Roaming\\Spotify\\Spotify\.exe/);
  });

  it('n’annonce pas un lancement si le client de bureau est introuvable', async () => {
    vi.mocked(launchSpotifyDesktop).mockResolvedValue({
      ok: false,
      detail: "Spotify.exe introuvable (AppData\\Spotify, WindowsApps, protocole spotify:).",
    });

    const result = await openApplicationTool.run({ name: 'Spotify' }, fakeContext());

    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/Impossible d'ouvrir Spotify/);
    expect(result.content).not.toMatch(/Application lancée/);
  });
});
