import { describe, expect, it, vi } from 'vitest';
import type { MediaProvider, MediaTrack, ToolContext } from '@jarvis/core';
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

describe('createSpotifyTools', () => {
  it('déclare les huit outils, tous en risque « safe » (y compris spotify_play)', () => {
    const tools = createSpotifyTools({ spotify: fakeBridge(() => stubProvider()) });

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
    const [playTool] = createSpotifyTools({ spotify: fakeBridge(() => provider) });

    const result = await playTool!.run({ query: 'get lucky' }, fakeContext());

    expect(provider.searchTrack).toHaveBeenCalledWith('get lucky');
    expect(provider.play).toHaveBeenCalledWith(track.uri, {
      contextUri: undefined,
      artistUri: undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Lecture lancée sur Spotify');
    expect(result.content).toContain('Get Lucky');
    expect(result.content).toContain('Daft Punk');
  });

  it('spotify_play répond clairement, sans lancer de lecture, quand aucun morceau ne correspond', async () => {
    const provider = stubProvider({ searchTrack: vi.fn(async () => null) });
    const [playTool] = createSpotifyTools({ spotify: fakeBridge(() => provider) });

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
    const [playTool] = createSpotifyTools({ spotify: fakeBridge(() => provider) });

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
    const [playTool] = createSpotifyTools({ spotify: fakeBridge(() => provider) });

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
    const tools = createSpotifyTools({ spotify: bridge });
    const pauseTool = tools.find((tool) => tool.name === 'spotify_pause')!;

    const result = await pauseTool.run({}, fakeContext());

    expect(result.ok).toBe(false);
    expect(result.content).toContain("n'est pas configuré");
  });

  it('spotify_set_volume transmet le pourcentage demandé', async () => {
    const provider = stubProvider();
    const [, , , , , volumeTool] = createSpotifyTools({ spotify: fakeBridge(() => provider) });

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
    const currentTrackTool = createSpotifyTools({ spotify: fakeBridge(() => provider) }).find(
      (tool) => tool.name === 'spotify_current_track',
    )!;

    const result = await currentTrackTool.run({}, fakeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Lecture');
    expect(result.content).toContain('Get Lucky');
    expect(result.content).toContain('Ordinateur de bureau');
  });

  it('spotify_current_track répond sans erreur quand rien ne joue', async () => {
    const currentTrackTool = createSpotifyTools({ spotify: fakeBridge(() => stubProvider()) }).find(
      (tool) => tool.name === 'spotify_current_track',
    )!;

    const result = await currentTrackTool.run({}, fakeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Aucun morceau Spotify');
  });
});
