import { hostname as osHostname } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { shell, app } from 'electron';
import {
  searchQueryVariants,
  type MediaProvider,
  type MediaTrack,
  type PlaybackState,
} from '@jarvis/core';
import { launchSpotifyDesktop } from './launchSpotifyDesktop.js';
import {
  formatPlaybackDiagnostic,
  pickLocalDesktopDevice,
  type ConnectDevice,
} from './spotifyDevices.js';

const API_BASE = 'https://api.spotify.com/v1';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REDIRECT_URI = 'http://127.0.0.1:53124/callback';
export const AUTH_PORT = 53124;

/**
 * Délai laissé à l'utilisateur pour valider l'autorisation dans son
 * navigateur avant d'abandonner. Sans ça, fermer l'onglet sans valider
 * laisse la promesse d'attente non résolue et le port 53124 occupé
 * indéfiniment (défaut corrigé lors de l'intégration de cette fonctionnalité).
 */
const AUTH_TIMEOUT_MS = 5 * 60_000;

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

type TokenStore = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type SpotifySearch = {
  tracks?: {
    items?: Array<{
      uri: string;
      name: string;
      artists?: Array<{ name: string; uri?: string }>;
      album?: { name: string; uri?: string };
    } | null>;
  };
};

type SpotifyDevice = {
  id: string | null;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
};

type SpotifyDevicesResponse = {
  devices?: SpotifyDevice[];
};

type SpotifyPlayback = {
  is_playing?: boolean;
  item?: {
    uri?: string;
    name?: string;
    artists?: Array<{ name: string }>;
    album?: { name: string };
  } | null;
  device?: {
    id?: string | null;
    name?: string;
    type?: string;
    volume_percent?: number;
  } | null;
};

export class SpotifyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Spotify API ${status}: ${message}`);
    this.name = 'SpotifyApiError';
  }
}

/**
 * Implémentation Spotify de `MediaProvider` (`@jarvis/core`). Vit côté
 * desktop parce qu'elle dépend de Node (serveur HTTP local, système de
 * fichiers) et d'Electron (ouverture du navigateur système, dossier de
 * données utilisateur) — voir `packages/core/src/media/types.ts` pour le
 * contrat partagé.
 */
export interface SpotifyProviderOptions {
  /** Délai avant abandon de l'attente d'autorisation. Surtout utile pour les tests. */
  authTimeoutMs?: number;
  /** Lancer le client Windows si aucun ordinateur Connect n'est visible. */
  launchDesktopClient?: () => Promise<{ ok: boolean } | boolean>;
  /** Attente max d'apparition du lecteur après lancement (ms). */
  deviceWaitMs?: number;
  pollIntervalMs?: number;
  /** Fenêtre pour relire `/me/player` après un PUT 204 (ms). */
  playbackVerifyMs?: number;
  hostname?: string;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_DEVICE_WAIT_MS = 12_000;
const DEFAULT_POLL_MS = 400;
const DEFAULT_PLAYBACK_VERIFY_MS = 8_000;
const AUDIBLE_VOLUME = 50;

export class SpotifyProvider implements MediaProvider {
  readonly id = 'spotify';

  private token: TokenStore | null = null;
  private authServer: Server | null = null;
  private readonly tokenPath: string;
  private readonly authTimeoutMs: number;
  private readonly launchDesktopClient: () => Promise<{ ok: boolean } | boolean>;
  private readonly deviceWaitMs: number;
  private readonly pollIntervalMs: number;
  private readonly playbackVerifyMs: number;
  private readonly hostname: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly clientId: string,
    options: SpotifyProviderOptions = {},
  ) {
    if (!clientId.trim()) {
      throw new Error(
        'Identifiant client Spotify manquant : renseigne-le dans les réglages de Jarvis.',
      );
    }
    this.tokenPath = join(app.getPath('userData'), 'spotify-token.json');
    this.authTimeoutMs = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
    this.launchDesktopClient = options.launchDesktopClient ?? launchSpotifyDesktop;
    this.deviceWaitMs = options.deviceWaitMs ?? DEFAULT_DEVICE_WAIT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.playbackVerifyMs = options.playbackVerifyMs ?? DEFAULT_PLAYBACK_VERIFY_MS;
    this.hostname = options.hostname ?? osHostname();
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async searchTrack(query: string): Promise<MediaTrack | null> {
    // `market=from_token` : sans marché, l'API Search renvoie souvent
    // `items: []` pour un jeton utilisateur (même requête exacte).
    // Les `items` peuvent contenir des `null` — on prend le premier URI.
    for (const candidate of searchQueryVariants(query)) {
      const track = await this.searchOnce(candidate, { market: 'from_token' });
      if (track) return track;
    }

    for (const candidate of searchQueryVariants(query)) {
      const track = await this.searchOnce(candidate, {});
      if (track) return track;
    }

    return null;
  }

  private async searchOnce(
    query: string,
    extra: Record<string, string>,
  ): Promise<MediaTrack | null> {
    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: '10',
      ...extra,
    });

    try {
      const response = await this.request<SpotifySearch>(`/search?${params}`, { method: 'GET' });
      const item = (response.tracks?.items ?? []).find((entry) => Boolean(entry?.uri));
      if (!item) return null;

      return {
        provider: this.id,
        uri: item.uri,
        title: item.name,
        artists: (item.artists ?? []).map((artist) => artist.name),
        album: item.album?.name,
        ...(item.album?.uri ? { contextUri: item.album.uri } : {}),
        ...(item.artists?.find((artist) => artist.uri)?.uri
          ? { artistUri: item.artists.find((artist) => artist.uri)?.uri }
          : {}),
      };
    } catch (error) {
      // `from_token` peut renvoyer 400 si le jeton n'a pas `user-read-private`.
      if (error instanceof SpotifyApiError && (error.status === 400 || error.status === 403)) {
        return null;
      }
      throw error;
    }
  }

  async play(
    trackUri?: string,
    options: { contextUri?: string; artistUri?: string } = {},
  ): Promise<void> {
    // Le desktop Windows ignore souvent un PUT /play 204 sur un morceau
    // isolé. On active le Computer (sans relancer l'ancien titre), on envoie
    // device_id + URI, on retente, puis album / artiste / file d'attente.
    const { device, devices } = await this.ensureDesktopDevice();
    const diagnostic = (state: SpotifyPlayback | null): string =>
      formatPlaybackDiagnostic(devices, state, device);

    await this.transferToDevice(device, false);
    await this.sleep(this.pollIntervalMs);

    const bodies: Array<Record<string, unknown> | undefined> = [];
    if (trackUri) {
      bodies.push({ uris: [trackUri], position_ms: 0 });
      bodies.push({ uris: [trackUri], position_ms: 0 });
      if (options.contextUri) {
        bodies.push({
          context_uri: options.contextUri,
          offset: { uri: trackUri },
          position_ms: 0,
        });
      }
      if (options.artistUri && options.artistUri !== options.contextUri) {
        bodies.push({ context_uri: options.artistUri });
      }
    } else {
      bodies.push(undefined);
    }

    let state: SpotifyPlayback | null = null;
    for (const body of bodies) {
      try {
        await this.putPlay(device.id!, body);
      } catch (error) {
        this.rethrowPlayError(error, diagnostic(state));
      }
      state = await this.pollPlayback(device.id!, this.playbackVerifyMs);
      if (this.isAudibleOnDevice(state, device.id!)) {
        await this.ensureAudibleVolume(state, device.id!);
        return;
      }
    }

    if (trackUri) {
      try {
        await this.request(
          `/me/player/queue?uri=${encodeURIComponent(trackUri)}&device_id=${encodeURIComponent(device.id!)}`,
          { method: 'POST' },
        );
        await this.request(`/me/player/next?device_id=${encodeURIComponent(device.id!)}`, {
          method: 'POST',
        });
      } catch (error) {
        if (!(error instanceof SpotifyApiError && (error.status === 404 || error.status === 403))) {
          this.rethrowPlayError(error, diagnostic(state));
        }
      }
      state = await this.pollPlayback(device.id!, this.playbackVerifyMs);
      if (this.isAudibleOnDevice(state, device.id!)) {
        await this.ensureAudibleVolume(state, device.id!);
        return;
      }

      await this.transferToDevice(device, true);
      try {
        await this.putPlay(device.id!, { uris: [trackUri], position_ms: 0 });
      } catch (error) {
        this.rethrowPlayError(error, diagnostic(state));
      }
      state = await this.pollPlayback(device.id!, this.playbackVerifyMs);
      if (this.isAudibleOnDevice(state, device.id!)) {
        await this.ensureAudibleVolume(state, device.id!);
        return;
      }
    }

    throw new Error(this.silentPlaybackMessage(state, device, diagnostic(state)));
  }

  private rethrowPlayError(error: unknown, diagnostic: string): never {
    if (error instanceof SpotifyApiError) {
      if (error.status === 403 && /premium/i.test(error.message)) {
        throw new Error(
          "Spotify Premium est requis pour piloter la lecture (limite de l'API Spotify, pas de Jarvis).",
        );
      }
      if (error.status === 404 || error.status === 403) {
        throw new Error(
          `La lecture n'a pas démarré sur le lecteur de bureau (HTTP ${error.status}). ${diagnostic}`,
        );
      }
    }
    throw error;
  }

  private async putPlay(
    deviceId: string,
    body: Record<string, unknown> | undefined,
  ): Promise<void> {
    await this.request(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async listAllDevices(): Promise<SpotifyDevice[]> {
    const response = await this.request<SpotifyDevicesResponse>('/me/player/devices');
    return response.devices ?? [];
  }

  /**
   * Client de bureau Windows uniquement (pas le téléphone, pas le lecteur
   * web), même s'ils sont déjà « actifs ». Lance Spotify.exe si besoin.
   */
  private async ensureDesktopDevice(): Promise<{
    device: SpotifyDevice;
    devices: SpotifyDevice[];
  }> {
    const pick = (devices: SpotifyDevice[]): SpotifyDevice | null => {
      const selected = pickLocalDesktopDevice(devices, this.hostname);
      if (!selected?.id) return null;
      return devices.find((device) => device.id === selected.id) ?? null;
    };

    let devices = await this.listAllDevices();
    const existing = pick(devices);
    if (existing) return { device: existing, devices };

    const launched = await this.launchDesktopClient();
    const launchedOk = typeof launched === 'boolean' ? launched : launched.ok;
    if (!launchedOk) {
      throw new Error(this.noDesktopDeviceMessage(devices, { launchFailed: true }));
    }

    const deadline = Date.now() + this.deviceWaitMs;
    while (Date.now() <= deadline) {
      await this.sleep(this.pollIntervalMs);
      devices = await this.listAllDevices();
      const appeared = pick(devices);
      if (appeared) return { device: appeared, devices };
    }

    throw new Error(this.noDesktopDeviceMessage(devices, { launchFailed: false }));
  }

  private noDesktopDeviceMessage(
    devices: ConnectDevice[],
    options: { launchFailed: boolean },
  ): string {
    const inventory = formatPlaybackDiagnostic(devices, null, null);
    if (options.launchFailed) {
      return `Impossible d'ouvrir l'application Spotify sur ce PC. ${inventory}`;
    }
    return `Aucun lecteur Spotify de bureau n'est apparu dans Connect. ${inventory}`;
  }

  private async transferToDevice(device: SpotifyDevice, startPlayback: boolean): Promise<void> {
    if (!device.id) return;
    try {
      await this.request('/me/player', {
        method: 'PUT',
        body: JSON.stringify({
          device_ids: [device.id],
          play: startPlayback,
        }),
      });
    } catch (error) {
      // Le PUT play avec `device_id` peut encore activer le lecteur.
      if (error instanceof SpotifyApiError && (error.status === 404 || error.status === 403)) {
        return;
      }
      throw error;
    }
  }

  private async fetchPlaybackSnapshot(): Promise<SpotifyPlayback | null> {
    try {
      const state = await this.request<SpotifyPlayback | undefined>('/me/player');
      return state ?? null;
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 204) return null;
      throw error;
    }
  }

  private isAudibleOnDevice(state: SpotifyPlayback | null, deviceId: string): boolean {
    if (!state?.is_playing) return false;
    if (state.device?.id !== deviceId) return false;
    if (state.device?.type && /smartphone|tablet|web/i.test(state.device.type)) return false;
    const volume = state.device.volume_percent;
    if (volume == null) return true;
    return volume > 0;
  }

  private async pollPlayback(deviceId: string, windowMs: number): Promise<SpotifyPlayback | null> {
    const deadline = Date.now() + windowMs;
    let last: SpotifyPlayback | null = null;
    let raisedVolume = false;
    while (true) {
      last = await this.fetchPlaybackSnapshot();
      if (this.isAudibleOnDevice(last, deviceId)) return last;
      if (
        last?.is_playing &&
        last.device?.id === deviceId &&
        (last.device.volume_percent ?? 0) <= 0 &&
        !raisedVolume
      ) {
        raisedVolume = true;
        try {
          await this.setVolume(AUDIBLE_VOLUME);
        } catch {
          // Relu ensuite.
        }
      }
      if (Date.now() >= deadline) return last;
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async ensureAudibleVolume(
    state: SpotifyPlayback | null,
    deviceId: string,
  ): Promise<void> {
    if (!state?.is_playing || state.device?.id !== deviceId) return;
    if ((state.device.volume_percent ?? 1) > 0) return;
    try {
      await this.setVolume(AUDIBLE_VOLUME);
    } catch {
      throw new Error(
        `La lecture est lancée sur « ${state.device.name || 'ce PC'} » mais le volume est à 0. ${formatPlaybackDiagnostic([], state, null)}`,
      );
    }
    const again = await this.pollPlayback(deviceId, Math.max(this.pollIntervalMs * 4, 800));
    if (!this.isAudibleOnDevice(again, deviceId)) {
      throw new Error(
        `La lecture est lancée sur « ${state.device.name || 'ce PC'} » mais le volume est à 0. ${formatPlaybackDiagnostic([], again ?? state, null)}`,
      );
    }
  }

  /**
   * Un 204 sur `/play` n'est pas une lecture audible. Pas de consigne
   * « rouvre l'appli » : elle l'est déjà (repro 0.4.4).
   */
  private silentPlaybackMessage(
    state: SpotifyPlayback | null,
    expected: SpotifyDevice,
    diagnostic: string,
  ): string {
    if (!state) {
      return `La lecture n'a pas démarré : is_playing=inconnu (204) après un PUT accepté. ${diagnostic}`;
    }
    if (!state.is_playing) {
      return `La lecture n'a pas démarré : is_playing=false sur « ${state.device?.name ?? expected.name} ». Spotify a accepté la commande (HTTP 204) mais le morceau n'a pas démarré. ${diagnostic}`;
    }
    const deviceName = state.device?.name ?? state.device?.type ?? 'un autre appareil';
    if (state.device?.id && state.device.id !== expected.id) {
      return `La lecture est sur « ${deviceName} », pas sur l'application de bureau Windows. ${diagnostic}`;
    }
    if ((state.device?.volume_percent ?? 0) <= 0) {
      return `La lecture est lancée sur « ${expected.name || 'ce PC'} » mais le volume est à 0. ${diagnostic}`;
    }
    return `La lecture n'a pas démarré sur l'application Spotify de ce PC. ${diagnostic}`;
  }

  async pause(): Promise<void> {
    await this.request('/me/player/pause', { method: 'PUT' });
  }

  async next(): Promise<void> {
    await this.request('/me/player/next', { method: 'POST' });
  }

  async previous(): Promise<void> {
    await this.request('/me/player/previous', { method: 'POST' });
  }

  async setVolume(percent: number): Promise<void> {
    await this.request(`/me/player/volume?volume_percent=${encodeURIComponent(percent)}`, {
      method: 'PUT',
    });
  }

  async setShuffle(enabled: boolean): Promise<void> {
    await this.request(`/me/player/shuffle?state=${encodeURIComponent(enabled)}`, {
      method: 'PUT',
    });
  }

  async getPlaybackState(): Promise<PlaybackState | null> {
    try {
      const state = await this.request<SpotifyPlayback>('/me/player');
      if (!state?.item) return null;

      return {
        isPlaying: Boolean(state.is_playing),
        track: {
          provider: this.id,
          uri: state.item.uri ?? '',
          title: state.item.name ?? 'Morceau inconnu',
          artists: (state.item.artists ?? []).map((artist) => artist.name),
          album: state.item.album?.name,
        },
        deviceName: state.device?.name ?? undefined,
        volumePercent: state.device?.volume_percent ?? undefined,
      };
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 204) return null;
      throw error;
    }
  }

  /**
   * État de connexion affiché dans les réglages : un jeton (même expiré,
   * tant qu'il reste accompagné d'un jeton de rafraîchissement) suffit à
   * considérer le compte comme connecté — `ensureToken` se chargera de le
   * renouveler au prochain appel réel.
   */
  async isConnected(): Promise<boolean> {
    await this.loadToken();
    return Boolean(this.token?.refreshToken);
  }

  /** Déclenche explicitement le flux d'autorisation, pour le bouton « Se connecter » des réglages. */
  async connect(): Promise<void> {
    await this.authorize();
  }

  /** Supprime le jeton local, en mémoire et sur disque : geste explicite de déconnexion. */
  async disconnect(): Promise<void> {
    this.token = null;
    await rm(this.tokenPath, { force: true });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    await this.ensureToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token!.accessToken}`,
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.body) headers['Content-Type'] = 'application/json';

    const send = () =>
      fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
      });

    let response = await send();

    if (response.status === 401) {
      await this.refreshToken();
      response = await send();
    }

    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      const body = await response.text();
      throw new SpotifyApiError(response.status, body.slice(0, 500));
    }

    return (await response.json()) as T;
  }

  private async ensureToken(): Promise<void> {
    await this.loadToken();

    if (this.token && Date.now() < this.token.expiresAt) return;

    if (this.token?.refreshToken) {
      await this.refreshToken();
      return;
    }

    throw new Error(
      "Spotify n'est pas connecté. Clique sur « Se connecter » dans les réglages, section Musique.",
    );
  }

  private async authorize(): Promise<void> {
    const verifier = randomBytes(64).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(32).toString('base64url');

    const codePromise = this.waitForAuthorizationCode(state);

    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    }).toString();

    await shell.openExternal(url.toString());
    const code = await codePromise;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      throw new Error(`Échec de l'authentification Spotify (${response.status}).`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.token = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
    };

    await this.saveToken();
  }

  private async refreshToken(): Promise<void> {
    if (!this.token?.refreshToken) {
      await this.authorize();
      return;
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: this.token.refreshToken,
      }),
    });

    if (!response.ok) {
      this.token = null;
      throw new Error('La connexion Spotify a expiré. Reconnecte Spotify.');
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    this.token = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? this.token.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
    };

    await this.saveToken();
  }

  private async loadToken(): Promise<void> {
    if (this.token) return;

    try {
      this.token = JSON.parse(await readFile(this.tokenPath, 'utf8')) as TokenStore;
    } catch {
      this.token = null;
    }
  }

  private async saveToken(): Promise<void> {
    await mkdir(dirname(this.tokenPath), { recursive: true });
    await writeFile(this.tokenPath, JSON.stringify(this.token), {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await chmod(this.tokenPath, 0o600);
    } catch {
      // Windows n'utilise pas les modes POSIX de la même façon.
    }
  }

  /**
   * Attend le retour du navigateur sur le serveur local. Corrigé lors de
   * l'intégration : un délai d'expiration rejette la promesse et referme le
   * serveur si l'utilisateur ferme l'onglet sans valider — sans ça, le port
   * 53124 restait occupé indéfiniment et l'appel de l'outil ne se terminait
   * jamais. `finish` ne s'exécute qu'une fois (`settled`), que ce soit une
   * requête HTTP ou l'expiration du délai qui la déclenche en premier ; le
   * serveur est systématiquement refermé dans les deux cas.
   */
  private waitForAuthorizationCode(expectedState: string): Promise<string> {
    if (this.authServer) {
      throw new Error('Une authentification Spotify est déjà en cours.');
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', REDIRECT_URI);

        if (url.pathname !== '/callback') {
          response.writeHead(404).end();
          return;
        }

        if (url.searchParams.get('state') !== expectedState) {
          response.writeHead(400).end('État OAuth invalide.');
          finish(new Error('État OAuth Spotify invalide.'));
          return;
        }

        const error = url.searchParams.get('error');
        if (error) {
          response.writeHead(400).end('Connexion Spotify annulée.');
          finish(new Error(`Connexion Spotify refusée : ${error}`));
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) {
          response.writeHead(400).end('Code OAuth manquant.');
          finish(new Error('Code OAuth Spotify manquant.'));
          return;
        }

        response
          .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          .end('<h2>Spotify connecté à Jarvis.</h2><p>Tu peux fermer cet onglet.</p>');

        finish(undefined, code);
      });

      const timeout = setTimeout(() => {
        finish(
          new Error(
            'Connexion Spotify expirée : aucune validation reçue dans le délai imparti. Relance la connexion depuis les réglages.',
          ),
        );
      }, this.authTimeoutMs);

      const finish = (error?: Error, code?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.authServer = null;
        server.close();
        if (error) reject(error);
        else if (code) resolve(code);
      };

      this.authServer = server;
      server.once('error', (error) => finish(error as Error));
      server.listen(AUTH_PORT, '127.0.0.1');
    });
  }
}
