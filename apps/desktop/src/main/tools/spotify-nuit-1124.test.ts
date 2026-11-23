import { parseSettings, type MediaProvider, type ToolContext } from '@jarvis/core';
import { describe, expect, it, vi } from 'vitest';
import type { SpotifyBridge } from '../media/SpotifyBridge.js';
import { createSpotifyTools } from './spotify.js';

/** Volume par crans et playlists / albums (24 novembre 2026). Faux Spotify, aucun appel réseau. */
function provider(overrides: Partial<MediaProvider> = {}): MediaProvider {
  return {
    id: 'spotify',
    searchTrack: vi.fn(async () => null),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    next: vi.fn(async () => undefined),
    previous: vi.fn(async () => undefined),
    setVolume: vi.fn(async () => undefined),
    setShuffle: vi.fn(async () => undefined),
    getPlaybackState: vi.fn(async () => null),
    ...overrides,
  };
}

function tool(name: string, spotify: MediaProvider) {
  const bridge = { getProvider: () => spotify } as unknown as SpotifyBridge;
  const found = createSpotifyTools({ spotify: bridge, getSettings: () => parseSettings({ spotifyClientId: 'client-synthetique' }) }).find((item) => item.name === name);
  if (!found) throw new Error(name);
  return found;
}

const context = { signal: new AbortController().signal, requestConfirmation: async () => false } as unknown as ToolContext;

describe('spotify_volume_step', () => {
  it('monte d’un cran, et dit le volume relu', async () => {
    let volume = 40;
    const spotify = provider({
      getPlaybackState: vi.fn(async () => ({ isPlaying: true, volumePercent: volume, deviceName: 'Ordinateur' })),
      setVolume: vi.fn(async (percent: number) => {
        volume = percent;
      }),
    });
    const result = await tool('spotify_volume_step', spotify).run({ direction: 'up' }, context);
    expect(spotify.setVolume).toHaveBeenCalledWith(50);
    expect(result).toMatchObject({ ok: true, content: 'Volume Spotify réglé à 50 %.' });
  });

  it('au plafond de l’enceinte (70) : le dit, sans prétendre avoir monté', async () => {
    const spotify = provider({
      getPlaybackState: vi.fn(async () => ({ isPlaying: true, volumePercent: 70, deviceName: 'Devialet' })),
    });
    const result = await tool('spotify_volume_step', spotify).run({ direction: 'up' }, context);
    expect(spotify.setVolume).toHaveBeenCalledWith(80);
    expect(result.content).toBe("Volume Spotify réglé à 70 % : c'est le plafond de sécurité de l'enceinte.");
  });

  it('sans lecture : le dit', async () => {
    const result = await tool('spotify_volume_step', provider()).run({ direction: 'down' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/aucune lecture en cours/);
  });

  it('sans Spotify réglé, ces outils internes ne sont pas enregistrés', () => {
    const bridge = { getProvider: () => provider() } as unknown as SpotifyBridge;
    const names = createSpotifyTools({ spotify: bridge, getSettings: () => parseSettings({}) }).map((item) => item.name);
    expect(names).not.toContain('spotify_volume_step');
    expect(names).not.toContain('spotify_play_collection');
  });

  it('reste hors du catalogue du modèle', () => {
    expect(tool('spotify_volume_step', provider()).internal).toBe(true);
    expect(tool('spotify_play_collection', provider()).internal).toBe(true);
  });
});

describe('spotify_play_collection', () => {
  it('trouve, lance et dit ce qui joue', async () => {
    const spotify = provider({
      searchCollection: vi.fn(async () => ({ kind: 'playlist' as const, uri: 'spotify:playlist:abc', name: 'Sport', by: ['Moi'], mine: true })),
      playCollection: vi.fn(async () => undefined),
      getPlaybackState: vi.fn(async () => ({
        isPlaying: true,
        deviceName: 'Devialet',
        track: { provider: 'spotify', uri: 'spotify:track:1', title: 'Un', artists: ['Artiste'] },
      })),
    });
    const result = await tool('spotify_play_collection', spotify).run({ kind: 'playlist', query: 'Sport', mine: true }, context);
    expect(spotify.searchCollection).toHaveBeenCalledWith('playlist', 'Sport', { mine: true });
    expect(spotify.playCollection).toHaveBeenCalledWith('spotify:playlist:abc', { deviceHint: null });
    expect(result.content).toBe('Lecture sur « Devialet » : la playlist Sport (une des tiennes). En ce moment : Un — Artiste.');
  });

  it('rien trouvé : le dit, ne lance rien', async () => {
    const spotify = provider({ searchCollection: vi.fn(async () => null), playCollection: vi.fn(async () => undefined) });
    const result = await tool('spotify_play_collection', spotify).run({ kind: 'album', query: 'Inconnu' }, context);
    expect(result).toMatchObject({ ok: false, content: 'Aucun album trouvé sur Spotify pour « Inconnu ».' });
    expect(spotify.playCollection).not.toHaveBeenCalled();
  });

  it('la lecture ne démarre pas : l’échec est dit, jamais « Lecture »', async () => {
    const spotify = provider({
      searchCollection: vi.fn(async () => ({ kind: 'album' as const, uri: 'spotify:album:x', name: 'Discovery', by: ['Daft Punk'] })),
      playCollection: vi.fn(async () => {
        throw new Error('Spotify ne joue rien sur « Ordinateur ».');
      }),
    });
    const result = await tool('spotify_play_collection', spotify).run({ kind: 'album', query: 'Discovery' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).not.toMatch(/^Lecture/);
  });
});
