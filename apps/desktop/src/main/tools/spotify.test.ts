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
  it('déclare les neuf outils, tous en risque « safe » (y compris spotify_play)', () => {
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
      'spotify_transfer',
    ]);
    for (const tool of tools) {
      expect(tool.risk).toBe('safe');
      expect(tool.forceConfirm).toBe(false);
    }
  });

  it('5.0.69 : spotify_play garde sa description de 0.4.22 ; spotify_transfer indisponible sans enceinte choisie', () => {
    const tools = createSpotifyTools({ spotify: fakeBridge(() => stubProvider()) });
    const play = tools.find((tool) => tool.name === 'spotify_play')!;
    expect(play.description).toBe(
      "Recherche un morceau sur Spotify (requête libre, fautes d’orthographe acceptées) et le lance sur l'application de bureau Windows — pas le téléphone ni le lecteur web. Vérifie que ça joue vraiment (is_playing, appareil, volume). Nécessite Spotify Premium. Ne jamais inventer un échec ni annoncer une lecture s'il n'y a pas de son.",
    );
    const transfer = tools.find((tool) => tool.name === 'spotify_transfer')!;
    expect(transfer.isAvailable?.()).toBe(false);
    const chosen = createSpotifyTools({ spotify: fakeBridge(() => stubProvider()), speakerChosen: () => true });
    expect(chosen.find((tool) => tool.name === 'spotify_transfer')!.isAvailable?.()).toBe(true);
  });

  it('5.0.69 : « mets Daft Punk sur l’enceinte » → recherche « Daft Punk », lecture sur l’enceinte (contexte), résultat qui dit où ça joue', async () => {
    const track = fakeTrack();
    const provider = stubProvider({
      searchTrack: vi.fn(async () => track),
      play: vi.fn(async () => ({ deviceName: 'Devialet Phantom', deviceType: 'Speaker', targeted: true })),
    });
    const [playTool] = createSpotifyTools({ spotify: fakeBridge(() => provider) });

    const result = await playTool!.run(
      { query: 'Daft Punk' },
      { ...fakeContext(), playbackTarget: { kind: 'speaker' } },
    );

    expect(provider.searchTrack).toHaveBeenCalledWith('Daft Punk');
    expect(provider.play).toHaveBeenCalledWith(track.uri, {
      contextUri: undefined,
      artistUri: undefined,
      device: { kind: 'speaker' },
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('sur « Devialet Phantom »');
    expect(result.content).toContain('Get Lucky');
  });

  it('5.0.69 : spotify_play sans appareil demandé ne dit pas où ça joue (résultat d’avant)', async () => {
    const provider = stubProvider({
      searchTrack: vi.fn(async () => fakeTrack()),
      play: vi.fn(async () => ({ deviceName: 'DESKTOP-THX', deviceType: 'Computer', targeted: false })),
    });
    const [playTool] = createSpotifyTools({ spotify: fakeBridge(() => provider) });
    const result = await playTool!.run({ query: 'get lucky' }, fakeContext());
    expect(result.content).toBe(
      'Lecture lancée sur Spotify : Get Lucky — Daft Punk, Pharrell Williams. Lecture vérifiée : is_playing=true et URI confirmée.',
    );
  });

  it('5.0.69 : spotify_transfer dit « fait » seulement après vérification, et relaie une enceinte introuvable telle quelle', async () => {
    const transferPlayback = vi.fn(async () => ({
      deviceName: 'Devialet Phantom',
      deviceType: 'Speaker',
      targeted: true,
    }));
    const provider = { ...stubProvider(), transferPlayback } as unknown as MediaProvider;
    const transfer = createSpotifyTools({
      spotify: fakeBridge(() => provider),
      speakerChosen: () => true,
    }).find((tool) => tool.name === 'spotify_transfer')!;

    const ok = await transfer.run({ device: 'enceinte' }, fakeContext());
    expect(transferPlayback).toHaveBeenCalledWith({ kind: 'speaker' });
    expect(ok.ok).toBe(true);
    expect(ok.content).toContain('joue maintenant sur « Devialet Phantom »');
    expect(ok.content).toContain('vérifiée');

    const missing = {
      ...stubProvider(),
      transferPlayback: vi.fn(async () => {
        throw new Error(
          'Je ne trouve pas « Devialet ». Allume-la ou lance une musique dessus une fois depuis ton téléphone.',
        );
      }),
    } as unknown as MediaProvider;
    const failed = await createSpotifyTools({ spotify: fakeBridge(() => missing), speakerChosen: () => true })
      .find((tool) => tool.name === 'spotify_transfer')!
      .run({ device: 'Devialet' }, fakeContext());
    expect(failed.ok).toBe(false);
    expect(failed.content).toBe(
      'Je ne trouve pas « Devialet ». Allume-la ou lance une musique dessus une fois depuis ton téléphone.',
    );

    const notVerified = {
      ...stubProvider(),
      transferPlayback: vi.fn(async () => {
        throw new Error("La lecture n'est pas passée sur « Devialet Phantom » : rien ne joue. Appareils Connect : []");
      }),
    } as unknown as MediaProvider;
    const stuck = await createSpotifyTools({ spotify: fakeBridge(() => notVerified), speakerChosen: () => true })
      .find((tool) => tool.name === 'spotify_transfer')!
      .run({ device: 'pc' }, fakeContext());
    expect(stuck.ok).toBe(false);
    expect(stuck.content).toContain("n'est pas passée sur");
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
    const volumeTool = createSpotifyTools({ spotify: fakeBridge(() => provider) }).find(
      (tool) => tool.name === 'spotify_set_volume',
    )!;

    const result = await volumeTool.run({ percent: 100 }, fakeContext());

    expect(provider.setVolume).toHaveBeenCalledWith(100);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('70');
    expect(result.content).toMatch(/plafond/);
  });
});
