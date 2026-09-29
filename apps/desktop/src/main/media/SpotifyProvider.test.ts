import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openExternalMock = vi.fn(async (_url: string) => true);
let userDataDir = '';

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir,
  },
  shell: {
    openExternal: openExternalMock,
  },
}));

const { AUTH_PORT, SpotifyApiError, SpotifyProvider } = await import('./SpotifyProvider.js');

function tokenPath(): string {
  return join(userDataDir, 'spotify-token.json');
}

async function readTokenFile(): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  return JSON.parse(await readFile(tokenPath(), 'utf8'));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function spotifyDevice(
  overrides: {
    id?: string | null;
    is_active?: boolean;
    is_restricted?: boolean;
    name?: string;
    type?: string;
    volume_percent?: number | null;
  } = {},
) {
  return {
    id: 'device-pc',
    is_active: true,
    is_restricted: false,
    name: 'Ordinateur',
    type: 'Computer',
    volume_percent: 50,
    ...overrides,
  };
}

/** Route les appels Player : liste d’appareils, transfert, lecture, état. */
function playbackFetchMock(
  options: {
    devices?: ReturnType<typeof spotifyDevice>[];
    devicesSequence?: Array<ReturnType<typeof spotifyDevice>[]>;
    playStatus?: number;
    playBody?: string;
    playback?:
      | Record<string, unknown>
      | null
      | (() => Record<string, unknown> | null | Response);
  } = {},
) {
  let devicesCall = 0;
  let lastDevices = options.devices ?? options.devicesSequence?.[0] ?? [spotifyDevice()];
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.includes('/me/player/devices')) {
      const list = options.devicesSequence
        ? (options.devicesSequence[Math.min(devicesCall, options.devicesSequence.length - 1)] ?? [])
        : (options.devices ?? [spotifyDevice()]);
      lastDevices = list;
      devicesCall += 1;
      return jsonResponse({ devices: list });
    }
    if (url.includes('/me/player/play')) {
      return new Response(options.playBody ?? null, { status: options.playStatus ?? 204 });
    }
    if (url.includes('/me/player/volume')) {
      return new Response(null, { status: 204 });
    }
    if (url.includes('/v1/me/player') && method === 'PUT') {
      return new Response(null, { status: 204 });
    }
    if (url.includes('/v1/me/player') && method === 'GET') {
      if (options.playback === undefined) {
        const devices = lastDevices;
        const computer = devices.find(
          (device) =>
            device.type.toLowerCase() === 'computer' &&
            !device.is_restricted &&
            Boolean(device.id) &&
            !/web\s*player/i.test(device.name),
        );
        const device = computer ?? devices.find((entry) => Boolean(entry.id)) ?? spotifyDevice();
        return jsonResponse({
          is_playing: true,
          item: {
            uri: 'spotify:track:xyz',
            name: 'Titre',
            artists: [{ name: 'Artiste' }],
          },
          device: {
            id: device.id,
            name: device.name,
            type: device.type,
            volume_percent: device.volume_percent ?? 50,
          },
        });
      }
      const playback = typeof options.playback === 'function' ? options.playback() : options.playback;
      if (playback instanceof Response) return playback;
      if (playback === null) return new Response(null, { status: 204 });
      return jsonResponse(playback);
    }
    return new Response(null, { status: 204 });
  });
}

function playProvider(
  overrides: ConstructorParameters<typeof SpotifyProvider>[1] = {},
): InstanceType<typeof SpotifyProvider> {
  return new SpotifyProvider('client-id', {
    sleep: async () => undefined,
    pollIntervalMs: 1,
    deviceWaitMs: 20,
    playbackVerifyMs: 20,
    hostname: 'DESKTOP-THX',
    launchDesktopClient: async () => ({ ok: false }),
    ...overrides,
  });
}

/** Jette un jeton valide sur disque, pour sauter l'étape d'autorisation dans les tests qui ne la concernent pas. */
async function seedValidToken(): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(userDataDir, { recursive: true });
  await writeFile(
    tokenPath(),
    JSON.stringify({
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Date.now() + 60 * 60_000,
    }),
    'utf8',
  );
}

async function seedExpiredToken(): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(userDataDir, { recursive: true });
  await writeFile(
    tokenPath(),
    JSON.stringify({
      accessToken: 'expired-access-token',
      refreshToken: 'expired-refresh-token',
      expiresAt: Date.now() - 60_000,
    }),
    'utf8',
  );
}

async function waitForCall(
  mockFn: { mock: { calls: unknown[][] } },
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (mockFn.mock.calls.length === 0) {
    if (Date.now() - start > timeoutMs)
      throw new Error('Délai dépassé en attendant l’appel du mock.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('SpotifyProvider', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'jarvis-spotify-test-'));
    openExternalMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it('refuse la construction sans identifiant client, sans jamais toucher process.env', async () => {
    expect(() => new SpotifyProvider('')).toThrow(/Identifiant client Spotify manquant/);
    expect(() => new SpotifyProvider('   ')).toThrow(/Identifiant client Spotify manquant/);
  });

  it('recherche un morceau et transmet le jeton dans l’en-tête Authorization', async () => {
    await seedValidToken();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        tracks: {
          items: [
            {
              uri: 'spotify:track:abc',
              name: 'Get Lucky',
              artists: [{ name: 'Daft Punk' }, { name: 'Pharrell Williams' }],
              album: { name: 'Random Access Memories' },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SpotifyProvider('client-id');
    const track = await provider.searchTrack('get lucky');

    expect(track).toEqual({
      provider: 'spotify',
      uri: 'spotify:track:abc',
      title: 'Get Lucky',
      artists: ['Daft Punk', 'Pharrell Williams'],
      album: 'Random Access Memories',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api.spotify.com/v1/search?');
    expect(url).toContain('market=from_token');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer valid-access-token',
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('renvoie null quand la recherche ne trouve aucun morceau', async () => {
    await seedValidToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ tracks: { items: [] } })),
    );

    const provider = new SpotifyProvider('client-id');
    await expect(provider.searchTrack('introuvable')).resolves.toBeNull();
  });

  it('ignore un item null en tête de liste Search (contrat Spotify)', async () => {
    await seedValidToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          tracks: {
            items: [
              null,
              {
                uri: 'spotify:track:nekfeu',
                name: 'On Verra',
                artists: [{ name: 'Nekfeu' }],
              },
            ],
          },
        }),
      ),
    );

    const provider = new SpotifyProvider('client-id');
    const track = await provider.searchTrack('On Verra de Nekfeu');
    expect(track?.title).toBe('On Verra');
    expect(track?.artists).toEqual(['Nekfeu']);
  });

  it('retente avec Nekfeu / On Verra quand la requête phonétique ne donne rien', async () => {
    await seedValidToken();
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('nekfeu') && url.includes('on+verra')) {
        return jsonResponse({
          tracks: {
            items: [
              {
                uri: 'spotify:track:nekfeu',
                name: 'On Verra',
                artists: [{ name: 'Nekfeu' }],
              },
            ],
          },
        });
      }
      return jsonResponse({ tracks: { items: [] } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SpotifyProvider('client-id');
    const track = await provider.searchTrack('un versat de Necfeu');
    expect(track?.title).toBe('On Verra');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('refuse la recherche sans jeton local (pas d’OAuth silencieux au milieu d’une commande)', async () => {
    const provider = new SpotifyProvider('client-id');
    await expect(provider.searchTrack('On Verra de Nekfeu')).rejects.toThrow(/pas connecté/);
  });

  it('transfère puis PUT play avec device_id et l’URI du morceau (même si le PC est déjà actif)', async () => {
    await seedValidToken();
    const desktop = spotifyDevice({
      id: 'pc-1',
      is_active: true,
      type: 'Computer',
      name: 'DESKTOP-THX',
    });
    const fetchMock = playbackFetchMock({ devices: [desktop] });
    vi.stubGlobal('fetch', fetchMock);

    const launchDesktopClient = vi.fn(async () => ({ ok: true }));
    await playProvider({ launchDesktopClient }).play('spotify:track:xyz');

    expect(launchDesktopClient).not.toHaveBeenCalled();
    const transferPuts = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url) === 'https://api.spotify.com/v1/me/player' &&
        (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(transferPuts).toHaveLength(1);
    expect(JSON.parse((transferPuts[0]?.[1] as RequestInit).body as string)).toEqual({
      device_ids: ['pc-1'],
      play: false,
    });
    const playInit = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/me/player/play?device_id=pc-1'),
    )?.[1] as RequestInit;
    expect(playInit.method).toBe('PUT');
    expect(JSON.parse(playInit.body as string)).toEqual({
      uris: ['spotify:track:xyz'],
      position_ms: 0,
    });
  });

  it('parmi plusieurs Computer, joue sur celui déjà actif', async () => {
    await seedValidToken();
    const fetchMock = playbackFetchMock({
      devices: [
        spotifyDevice({
          id: 'pc-idle',
          is_active: false,
          type: 'Computer',
          name: 'DESKTOP-THX',
        }),
        spotifyDevice({
          id: 'pc-live',
          is_active: true,
          type: 'Computer',
          name: 'Ordinateur',
        }),
      ],
      playback: {
        is_playing: true,
        item: { uri: 'spotify:track:xyz', name: 'Titre' },
        device: { id: 'pc-live', name: 'Ordinateur', type: 'Computer', volume_percent: 50 },
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    await playProvider().play('spotify:track:xyz');
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/me/player/play?device_id=pc-live'),
      ),
    ).toBe(true);
  });

  it('transfère vers le client de bureau même si le téléphone est déjà actif', async () => {
    await seedValidToken();
    const fetchMock = playbackFetchMock({
      devices: [
        spotifyDevice({
          id: 'phone-1',
          is_active: true,
          type: 'Smartphone',
          name: 'iPhone',
        }),
        spotifyDevice({
          id: 'pc-1',
          is_active: false,
          type: 'Computer',
          name: 'DESKTOP-THX',
        }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    await playProvider().play('spotify:track:xyz');

    const transferInit = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === 'https://api.spotify.com/v1/me/player' &&
        (init as RequestInit | undefined)?.method === 'PUT',
    )?.[1] as RequestInit;
    expect(JSON.parse(transferInit.body as string)).toEqual({
      device_ids: ['pc-1'],
      play: false,
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/me/player/play?device_id=pc-1'),
      ),
    ).toBe(true);
  });

  it('reprend la lecture sans URI (PUT sans corps) quand aucun morceau n’est précisé', async () => {
    await seedValidToken();
    const fetchMock = playbackFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    await playProvider().play();

    const playCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/me/player/play'));
    expect(playCall?.[1]?.body).toBeUndefined();
  });

  it('ouvre le client Windows puis attend un appareil Computer avant de lancer', async () => {
    await seedValidToken();
    const desktop = spotifyDevice({
      id: 'pc-1',
      is_active: false,
      type: 'Computer',
      name: 'DESKTOP-THX',
    });
    const fetchMock = playbackFetchMock({
      devicesSequence: [[], [desktop]],
    });
    vi.stubGlobal('fetch', fetchMock);

    const launchDesktopClient = vi.fn(async () => ({ ok: true }));
    await playProvider({ launchDesktopClient }).play('spotify:track:xyz');

    expect(launchDesktopClient).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/me/player/play?device_id=pc-1'),
      ),
    ).toBe(true);
  });

  it('n’annonce pas une lecture sur un téléphone / enceinte s’il n’y a pas de PC', async () => {
    await seedValidToken();
    const fetchMock = playbackFetchMock({
      devices: [
        spotifyDevice({
          id: 'phone-1',
          is_active: true,
          type: 'Smartphone',
          name: 'iPhone',
        }),
        spotifyDevice({
          id: 'speaker-ok',
          is_active: false,
          type: 'Speaker',
          name: 'Salon',
        }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(playProvider().play('spotify:track:xyz')).rejects.toThrow(
      /Impossible d'ouvrir l'application Spotify sur ce PC/,
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/me/player/play'))).toBe(
      false,
    );
  });

  it('explique clairement l’absence de lecteur de bureau au lieu de renvoyer le brut Spotify', async () => {
    await seedValidToken();
    const fetchMock = playbackFetchMock({ devices: [] });
    vi.stubGlobal('fetch', fetchMock);

    await expect(playProvider().play('spotify:track:xyz')).rejects.toThrow(
      /Impossible d'ouvrir l'application Spotify sur ce PC/,
    );
  });

  it('ne considère pas un PUT 204 comme un succès si GET /me/player ne joue rien', async () => {
    await seedValidToken();
    const fetchMock = playbackFetchMock({
      devices: [spotifyDevice({ id: 'pc-1', is_active: true, name: 'DESKTOP-THX' })],
      playback: null,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(playProvider().play('spotify:track:xyz')).rejects.toThrow(
      /La lecture n'a pas démarré[\s\S]*is_playing=inconnu \(204\)[\s\S]*Appareils Connect/,
    );
  });

  it('repro 0.4.4 : is_playing=false après 204, diagnostic sans « rouvre l’appli »', async () => {
    await seedValidToken();
    const fetchMock = playbackFetchMock({
      devices: [
        spotifyDevice({
          id: 'pc-1',
          is_active: true,
          name: 'Ordinateur',
          volume_percent: 100,
        }),
      ],
      playback: {
        is_playing: false,
        item: { uri: 'spotify:track:xyz', name: 'Titre' },
        device: {
          id: 'pc-1',
          name: 'Ordinateur',
          type: 'Computer',
          volume_percent: 100,
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const error = await playProvider()
      .play('spotify:track:xyz')
      .then(
        () => {
          throw new Error('aurait dû échouer');
        },
        (caught: unknown) => caught as Error,
      );

    expect(error.message).toMatch(/is_playing=false/);
    expect(error.message).toMatch(/Appareils Connect/);
    expect(error.message).toMatch(/Ordinateur/);
    expect(error.message).not.toMatch(/application de bureau est ouverte/i);
    expect(error.message).not.toMatch(/Ouvre Spotify sur ce PC/i);
  });

  it('si le morceau isolé est ignoré, relance via le contexte album', async () => {
    await seedValidToken();
    const playBodies: unknown[] = [];
    const fetchMock = playbackFetchMock({
      devices: [spotifyDevice({ id: 'pc-1', is_active: true, name: 'Ordinateur' })],
      playback: () => {
        const last = playBodies[playBodies.length - 1] as Record<string, unknown> | undefined;
        if (last && 'context_uri' in last) {
          return {
            is_playing: true,
            item: { uri: 'spotify:track:xyz', name: 'Titre' },
            device: { id: 'pc-1', name: 'Ordinateur', type: 'Computer', volume_percent: 80 },
          };
        }
        return {
          is_playing: false,
          device: { id: 'pc-1', name: 'Ordinateur', type: 'Computer', volume_percent: 80 },
        };
      },
    });
    const wrapped = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/me/player/play') && init?.body) {
        playBodies.push(JSON.parse(init.body as string));
      }
      return fetchMock(input, init);
    });
    vi.stubGlobal('fetch', wrapped);

    await playProvider().play('spotify:track:xyz', { contextUri: 'spotify:album:abc' });
    expect(playBodies.some((body) => body && typeof body === 'object' && 'context_uri' in body)).toBe(
      true,
    );
  });

  it('retente le PUT play device_id+URI si is_playing reste false', async () => {
    await seedValidToken();
    let plays = 0;
    const fetchMock = playbackFetchMock({
      devices: [spotifyDevice({ id: 'pc-1', is_active: true, name: 'Ordinateur' })],
      playback: () => {
        if (plays >= 2) {
          return {
            is_playing: true,
            item: { uri: 'spotify:track:xyz', name: 'Titre' },
            device: { id: 'pc-1', name: 'Ordinateur', type: 'Computer', volume_percent: 80 },
          };
        }
        return {
          is_playing: false,
          device: { id: 'pc-1', name: 'Ordinateur', type: 'Computer', volume_percent: 80 },
        };
      },
    });
    const wrapped = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/me/player/play')) plays += 1;
      return fetchMock(input, init);
    });
    vi.stubGlobal('fetch', wrapped);

    await playProvider().play('spotify:track:xyz');
    expect(plays).toBeGreaterThanOrEqual(2);
  });

  it('si le contexte échoue, enfile le morceau et passe au suivant', async () => {
    await seedValidToken();
    let queued = false;
    const fetchMock = playbackFetchMock({
      devices: [spotifyDevice({ id: 'pc-1', is_active: true, name: 'Ordinateur' })],
      playback: () => {
        if (queued) {
          return {
            is_playing: true,
            item: { uri: 'spotify:track:xyz', name: 'Titre' },
            device: { id: 'pc-1', name: 'Ordinateur', type: 'Computer', volume_percent: 80 },
          };
        }
        return {
          is_playing: false,
          device: { id: 'pc-1', name: 'Ordinateur', type: 'Computer', volume_percent: 80 },
        };
      },
    });
    const wrapped = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/me/player/queue')) queued = true;
      return fetchMock(input, init);
    });
    vi.stubGlobal('fetch', wrapped);

    await playProvider().play('spotify:track:xyz');
    expect(wrapped.mock.calls.some(([url]) => String(url).includes('/me/player/queue'))).toBe(true);
    expect(wrapped.mock.calls.some(([url]) => String(url).includes('/me/player/next'))).toBe(true);
  });

  it('échoue si Spotify joue sur un autre appareil après le transfert', async () => {
    await seedValidToken();
    const fetchMock = playbackFetchMock({
      devices: [
        spotifyDevice({
          id: 'phone-1',
          is_active: true,
          type: 'Smartphone',
          name: 'iPhone',
        }),
        spotifyDevice({
          id: 'pc-1',
          is_active: false,
          type: 'Computer',
          name: 'DESKTOP-THX',
        }),
      ],
      playback: {
        is_playing: true,
        item: { uri: 'spotify:track:xyz', name: 'Titre' },
        device: { id: 'phone-1', name: 'iPhone', type: 'Smartphone', volume_percent: 80 },
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(playProvider().play('spotify:track:xyz')).rejects.toThrow(
      /pas sur l'application de bureau Windows/,
    );
  });

  it('remonte le volume à 50 % si la lecture est silencieuse (volume 0)', async () => {
    await seedValidToken();
    let volumeCalls = 0;
    const fetchMock = playbackFetchMock({
      devices: [spotifyDevice({ id: 'pc-1', is_active: true, name: 'DESKTOP-THX', volume_percent: 0 })],
      playback: () => {
        if (volumeCalls === 0) {
          return {
            is_playing: true,
            item: { uri: 'spotify:track:xyz', name: 'Titre' },
            device: { id: 'pc-1', name: 'DESKTOP-THX', type: 'Computer', volume_percent: 0 },
          };
        }
        return {
          is_playing: true,
          item: { uri: 'spotify:track:xyz', name: 'Titre' },
          device: { id: 'pc-1', name: 'DESKTOP-THX', type: 'Computer', volume_percent: 50 },
        };
      },
    });
    const wrapped = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/me/player/volume')) volumeCalls += 1;
      return fetchMock(input, init);
    });
    vi.stubGlobal('fetch', wrapped);

    await playProvider().play('spotify:track:xyz');
    expect(volumeCalls).toBe(1);
    expect(wrapped.mock.calls.some(([url]) => String(url).includes('volume_percent=50'))).toBe(true);
  });

  it('échoue en français si le volume reste à 0', async () => {
    await seedValidToken();
    const fetchMock = playbackFetchMock({
      devices: [spotifyDevice({ id: 'pc-1', is_active: true, name: 'DESKTOP-THX', volume_percent: 0 })],
      playback: {
        is_playing: true,
        item: { uri: 'spotify:track:xyz', name: 'Titre' },
        device: { id: 'pc-1', name: 'DESKTOP-THX', type: 'Computer', volume_percent: 0 },
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(playProvider().play('spotify:track:xyz')).rejects.toThrow(/volume est à 0/);
  });

  it('rafraîchit un jeton expiré avant d’appeler l’API, et persiste le nouveau sur disque', async () => {
    await seedExpiredToken();

    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url === 'https://accounts.spotify.com/api/token') {
        return jsonResponse({
          access_token: 'refreshed-access-token',
          refresh_token: 'refreshed-refresh-token',
          expires_in: 3600,
        });
      }
      return jsonResponse({
        is_playing: true,
        item: {
          uri: 'spotify:track:now',
          name: 'Around the World',
          artists: [{ name: 'Daft Punk' }],
        },
        device: { name: 'Ordinateur', volume_percent: 40 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SpotifyProvider('client-id');
    const state = await provider.getPlaybackState();

    expect(state?.track?.title).toBe('Around the World');

    // Le rafraîchissement doit précéder l'appel réel, avec le nouveau jeton.
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://accounts.spotify.com/api/token');
    const [, playbackInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((playbackInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer refreshed-access-token',
    );

    const persisted = await readTokenFile();
    expect(persisted.accessToken).toBe('refreshed-access-token');
    expect(persisted.refreshToken).toBe('refreshed-refresh-token');
  });

  it('rafraîchit aussi sur un 401 reçu en cours de route, puis retente la même requête', async () => {
    await seedValidToken(); // valide selon expiresAt, mais Spotify le rejette quand même (jeton révoqué côté serveur)

    let searchCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === 'https://accounts.spotify.com/api/token') {
        return jsonResponse({ access_token: 'new-token', expires_in: 3600 });
      }
      searchCalls += 1;
      if (searchCalls === 1) return new Response('token révoqué', { status: 401 });
      return jsonResponse({ tracks: { items: [{ uri: 'spotify:track:1', name: 'Titre' }] } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SpotifyProvider('client-id');
    const track = await provider.searchTrack('titre');

    expect(track?.title).toBe('Titre');
    expect(fetchMock).toHaveBeenCalledTimes(3); // recherche (401) → rafraîchissement → recherche (200)
  });

  it('propage une erreur API exploitable (SpotifyApiError) sans planter, et n’expose jamais le jeton dans le message', async () => {
    await seedValidToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Rate limit exceeded', { status: 429 })),
    );

    const provider = new SpotifyProvider('client-id');
    await expect(provider.pause()).rejects.toThrow(SpotifyApiError);
    await expect(provider.pause()).rejects.toThrow(/429/);

    try {
      await provider.pause();
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('valid-access-token');
    }
  });

  it('renvoie une erreur claire (pas une exception muette) quand le rafraîchissement échoue', async () => {
    await seedExpiredToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid_grant', { status: 400 })),
    );

    const provider = new SpotifyProvider('client-id');
    await expect(provider.pause()).rejects.toThrow(/La connexion Spotify a expiré/);
  });

  it('getPlaybackState renvoie null quand rien ne joue (204 sans contenu)', async () => {
    await seedValidToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    const provider = new SpotifyProvider('client-id');
    await expect(provider.getPlaybackState()).resolves.toBeNull();
  });

  it('isConnected() est faux sans jeton local, vrai après connexion, faux après déconnexion', async () => {
    const provider = new SpotifyProvider('client-id');
    await expect(provider.isConnected()).resolves.toBe(false);

    await seedValidToken();
    await expect(provider.isConnected()).resolves.toBe(true);

    await provider.disconnect();
    await expect(provider.isConnected()).resolves.toBe(false);
  });

  it(
    "conduit la boucle complète d'autorisation PKCE : ouverture du navigateur, callback local, " +
      'échange du code, persistance du jeton',
    async () => {
      const tokenExchangeMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
        const body = new URLSearchParams((init?.body as string) ?? '');
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('fake-authorization-code');
        expect(body.get('code_verifier')).toBeTruthy();
        return jsonResponse({
          access_token: 'brand-new-access-token',
          refresh_token: 'brand-new-refresh-token',
          expires_in: 3600,
        });
      });
      vi.stubGlobal('fetch', tokenExchangeMock);

      const provider = new SpotifyProvider('client-id');
      const connectPromise = provider.connect();

      await waitForCall(openExternalMock);
      const authorizeUrl = new URL(openExternalMock.mock.calls[0]?.[0] as string);
      expect(authorizeUrl.origin).toBe('https://accounts.spotify.com');
      expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
      const state = authorizeUrl.searchParams.get('state');
      expect(state).toBeTruthy();

      // Simule le navigateur qui revient sur le serveur local après validation.
      const callbackStatus = await new Promise<number>((resolve, reject) => {
        httpGet(
          `http://127.0.0.1:${AUTH_PORT}/callback?state=${state}&code=fake-authorization-code`,
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        ).on('error', reject);
      });
      expect(callbackStatus).toBe(200);

      await connectPromise;

      expect(tokenExchangeMock).toHaveBeenCalledWith(
        'https://accounts.spotify.com/api/token',
        expect.anything(),
      );
      await expect(provider.isConnected()).resolves.toBe(true);
      const persisted = await readTokenFile();
      expect(persisted.accessToken).toBe('brand-new-access-token');
    },
  );

  it(
    'expire proprement si personne ne valide dans le navigateur : message clair, ' +
      'et le port local est bien libéré ensuite',
    async () => {
      vi.stubGlobal('fetch', vi.fn());

      const provider = new SpotifyProvider('client-id', { authTimeoutMs: 30 });
      await expect(provider.connect()).rejects.toThrow(/expirée/);

      // Le port doit être libre : un serveur peut s'y attacher immédiatement, sans EADDRINUSE.
      const { createServer } = await import('node:http');
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.once('listening', resolve);
        probe.listen(AUTH_PORT, '127.0.0.1');
      });
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    },
  );
});
