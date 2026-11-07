import { describe, expect, it, vi } from 'vitest';
import type { MediaProvider, MediaTrack, ToolContext } from '@jarvis/core';
import {
  extractSpotifyPlayDeviceHint,
  extractSpotifyPlayQuery,
  parseSettings,
  stashSpotifyPlayDeviceHint,
  takeSpotifyPlayDeviceHint,
} from '@jarvis/core';
import { createSpotifyTools } from './spotify.js';
import type { SpotifyBridge } from '../media/SpotifyBridge.js';

function fakeBridge(getProvider: () => MediaProvider): SpotifyBridge {
  return { getProvider } as unknown as SpotifyBridge;
}

function fakeContext(): ToolContext {
  return { requestConfirmation: async () => true };
}

function fakeTrack(): MediaTrack {
  return {
    uri: 'spotify:track:1',
    title: 'Get Lucky',
    artists: ['Daft Punk', 'Pharrell Williams'],
    provider: 'spotify',
  };
}

function stubProvider(overrides: Partial<MediaProvider> = {}): MediaProvider {
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

function spotifyDeps(getProvider: () => MediaProvider, settings = parseSettings({})) {
  return { spotify: fakeBridge(getProvider), getSettings: () => settings };
}

describe('createSpotifyTools', () => {
  it('déclare les outils Spotify (transfert enregistré mais absent du catalogue sans enceinte réglée)', () => {
    const tools = createSpotifyTools(spotifyDeps(() => stubProvider()));

    expect(tools.map((tool) => tool.name)).toEqual([
      'spotify_play',
      'spotify_pause',
      'spotify_resume',
      'spotify_next',
      'spotify_previous',
      'spotify_set_volume',
      'spotify_set_shuffle',
      'spotify_current_track',
    ]);
    const withSpeaker = createSpotifyTools(
      spotifyDeps(() => stubProvider(), parseSettings({ spotifyDeviceName: 'Devialet' })),
    );
    expect(withSpeaker.map((tool) => tool.name)).toContain('spotify_transfer');
    expect(withSpeaker.find((tool) => tool.name === 'spotify_transfer')?.isAvailable?.()).toBe(
      true,
    );
    for (const tool of tools) {
      expect(tool.risk).toBe('safe');
      expect(tool.forceConfirm).toBe(false);
    }
  });

  it('spotify_play cherche puis lance le morceau trouvé — la boucle agent → outil → service simulé', async () => {
    const track = fakeTrack();
    const provider = stubProvider({
      searchTrack: vi.fn(async () => track),
    });
    const [playTool] = createSpotifyTools(spotifyDeps(() => provider));

    const result = await playTool!.run({ query: 'get lucky' }, fakeContext());

    expect(provider.searchTrack).toHaveBeenCalledWith('get lucky');
    expect(provider.play).toHaveBeenCalledWith(track.uri, {
      contextUri: undefined,
      artistUri: undefined,
      deviceHint: null,
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Lecture lancée sur Spotify');
    expect(result.content).toContain('Get Lucky');
    expect(result.content).toContain('Daft Punk');
  });

  it('spotify_play répond clairement, sans lancer de lecture, quand aucun morceau ne correspond', async () => {
    const provider = stubProvider({ searchTrack: vi.fn(async () => null) });
    const [playTool] = createSpotifyTools(spotifyDeps(() => provider));

    const result = await playTool!.run({ query: 'introuvable' }, fakeContext());

    expect(provider.play).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Aucun morceau trouvé');
  });

  it('relaye tel quel un échec « rien ne joue » (204 / volume 0 / mauvais appareil)', async () => {
    const provider = stubProvider({
      searchTrack: vi.fn(async () => fakeTrack()),
      play: vi.fn(async () => {
        throw new Error(
          "La lecture n'a pas démarré : is_playing=false sur « Ordinateur ». Spotify a accepté la commande (HTTP 204) mais le morceau n'a pas démarré. Appareils Connect : [name=« Ordinateur » type=Computer actif=oui vol=100 id=pc-1] État : is_playing=false, appareil=« Ordinateur » (Computer).",
        );
      }),
    });
    const [playTool] = createSpotifyTools(spotifyDeps(() => provider));

    const result = await playTool!.run({ query: 'get lucky' }, fakeContext());

    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/La lecture n'a pas démarré/);
    expect(result.content).toMatch(/Appareils Connect/);
    expect(result.content).toMatch(/is_playing=false/);
    expect(result.content).not.toMatch(/^Impossible de lancer la musique sur Spotify :/);
  });

  it('remonte un message exploitable, sans exception, quand le service simulé échoue', async () => {
    const provider = stubProvider({
      searchTrack: vi.fn(async () => {
        throw new Error('Spotify API 500: erreur serveur');
      }),
    });
    const [playTool] = createSpotifyTools(spotifyDeps(() => provider));

    const result = await playTool!.run({ query: 'x' }, fakeContext());

    expect(result.ok).toBe(false);
    expect(result.content).toContain('Impossible de lancer la musique sur Spotify');
    expect(result.content).toContain('erreur serveur');
  });

  it('spotify_pause échoue proprement, sans exception, quand Spotify n’est pas configuré', async () => {
    const bridge = fakeBridge(() => {
      throw new Error(
        "Spotify n'est pas configuré. Renseigne l'identifiant client Spotify dans les réglages de Jarvis.",
      );
    });
    const tools = createSpotifyTools({ spotify: bridge, getSettings: () => parseSettings({}) });
    const pauseTool = tools.find((tool) => tool.name === 'spotify_pause')!;

    const result = await pauseTool.run({}, fakeContext());

    expect(result.ok).toBe(false);
    expect(result.content).toContain("n'est pas configuré");
  });

  it('spotify_set_volume transmet le pourcentage demandé', async () => {
    const provider = stubProvider();
    const [, , , , , volumeTool] = createSpotifyTools(spotifyDeps(() => provider));

    const result = await volumeTool!.run({ percent: 42 }, fakeContext());

    expect(provider.setVolume).toHaveBeenCalledWith(42);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('42 %');
  });

  it('spotify_current_track décrit le morceau en cours, avec l’appareil actif', async () => {
    const provider = stubProvider({
      getPlaybackState: vi.fn(async () => ({
        isPlaying: true,
        track: fakeTrack(),
        deviceName: 'Ordinateur de bureau',
      })),
    });
    const currentTrackTool = createSpotifyTools(spotifyDeps(() => provider)).find(
      (tool) => tool.name === 'spotify_current_track',
    )!;

    const result = await currentTrackTool.run({}, fakeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Lecture');
    expect(result.content).toContain('Get Lucky');
    expect(result.content).toContain('Ordinateur de bureau');
  });

  it('spotify_set_volume annonce le plafond enceinte quand le volume demandé est réduit', async () => {
    const provider = stubProvider({
      setVolume: vi.fn(async () => undefined),
      getPlaybackState: vi.fn(async () => ({
        isPlaying: true,
        volumePercent: 70,
        track: fakeTrack(),
        deviceName: 'Devialet',
      })),
    });
    const volumeTool = createSpotifyTools(spotifyDeps(() => provider)).find(
      (tool) => tool.name === 'spotify_set_volume',
    )!;

    const result = await volumeTool.run({ percent: 100 }, fakeContext());

    expect(provider.setVolume).toHaveBeenCalledWith(100);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('70');
    expect(result.content).toMatch(/plafond/);
  });

  it('ne retient un nom d’appareil que s’il est visible ; sinon la phrase entière part sur l’appareil habituel', async () => {
    takeSpotifyPlayDeviceHint();
    const visible: Array<{ id: string; name: string; type: string; is_active: boolean }> = [
      { id: 'pc-1', name: 'Ordinateur', type: 'Computer', is_active: true },
    ];
    const provider = stubProvider({
      searchTrack: vi.fn(async () => fakeTrack()),
      listConnectDevices: vi.fn(async () => visible.map((device) => ({ ...device }))),
      transferPlayback: vi.fn(async () => ({ deviceName: 'Devialet Phantom' })),
    });
    const tools = createSpotifyTools(
      spotifyDeps(() => provider, parseSettings({ spotifyDeviceName: 'Devialet' })),
    );
    const playTool = tools.find((tool) => tool.name === 'spotify_play')!;
    const transferTool = tools.find((tool) => tool.name === 'spotify_transfer')!;
    const playOn = async (prompt: string, queryFromModel?: string) => {
      const extracted = extractSpotifyPlayQuery(prompt);
      stashSpotifyPlayDeviceHint(extractSpotifyPlayDeviceHint(prompt));
      return playTool.run({ query: queryFromModel ?? extracted ?? prompt }, fakeContext());
    };

    expect(extractSpotifyPlayQuery('mets Il pleut sur la ville')).toBe('Il pleut sur la ville');
    await playOn('mets Il pleut sur la ville');
    expect(provider.searchTrack).toHaveBeenLastCalledWith('Il pleut sur la ville');
    expect(provider.play).toHaveBeenLastCalledWith('spotify:track:1', {
      contextUri: undefined,
      artistUri: undefined,
      deviceHint: null,
    });

    await playTool.run({ query: 'Il pleut sur la ville' }, fakeContext());
    expect(provider.searchTrack).toHaveBeenLastCalledWith('Il pleut sur la ville');
    expect(provider.play).toHaveBeenLastCalledWith('spotify:track:1', {
      contextUri: undefined,
      artistUri: undefined,
      deviceHint: null,
    });

    visible.push({ id: 'dv-1', name: 'Devialet Phantom', type: 'Speaker', is_active: false });
    expect(extractSpotifyPlayQuery('mets Daft Punk sur la Devialet')).toBe(
      'Daft Punk sur la Devialet',
    );
    await playOn('mets Daft Punk sur la Devialet');
    expect(provider.searchTrack).toHaveBeenLastCalledWith('Daft Punk');
    expect(provider.play).toHaveBeenLastCalledWith('spotify:track:1', {
      contextUri: undefined,
      artistUri: undefined,
      deviceHint: { kind: 'named', name: 'Devialet' },
    });

    const speaker = 'mets Daft Punk sur l’enceinte';
    const pc = 'mets Daft Punk sur le PC';
    const computer = 'mets Daft Punk sur l’ordinateur';
    expect(extractSpotifyPlayQuery(speaker)).toBe('Daft Punk');
    expect(extractSpotifyPlayDeviceHint(speaker)).toEqual({ kind: 'speaker' });
    expect(extractSpotifyPlayQuery(pc)).toBe('Daft Punk');
    expect(extractSpotifyPlayDeviceHint(pc)).toEqual({ kind: 'pc' });
    expect(extractSpotifyPlayQuery(computer)).toBe('Daft Punk');
    expect(extractSpotifyPlayDeviceHint(computer)).toEqual({ kind: 'pc' });

    await playOn(speaker);
    expect(provider.searchTrack).toHaveBeenLastCalledWith('Daft Punk');
    expect(provider.play).toHaveBeenLastCalledWith('spotify:track:1', {
      contextUri: undefined,
      artistUri: undefined,
      deviceHint: { kind: 'speaker' },
    });
    await playOn(pc);
    expect(provider.play).toHaveBeenLastCalledWith('spotify:track:1', {
      contextUri: undefined,
      artistUri: undefined,
      deviceHint: { kind: 'pc' },
    });
    await playOn(computer);
    expect(provider.searchTrack).toHaveBeenLastCalledWith('Daft Punk');
    expect(provider.play).toHaveBeenLastCalledWith('spotify:track:1', {
      contextUri: undefined,
      artistUri: undefined,
      deviceHint: { kind: 'pc' },
    });

    const unknown = await transferTool.run({ target: 'ville' }, fakeContext());
    expect(unknown.ok).toBe(false);
    expect(unknown.content).toBe("Je ne vois pas d'appareil appelé ville");
    expect(provider.transferPlayback).not.toHaveBeenCalled();

    const moved = await transferTool.run({ target: 'Devialet' }, fakeContext());
    expect(moved.ok).toBe(true);
    expect(provider.transferPlayback).toHaveBeenCalledTimes(1);
    expect(provider.transferPlayback).toHaveBeenCalledWith({ kind: 'named', name: 'Devialet' });
  });
});
