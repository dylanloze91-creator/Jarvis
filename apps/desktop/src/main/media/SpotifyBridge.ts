import type { Settings } from '@jarvis/core';
import {
  DEFAULT_SPEAKER_MAX_VOLUME,
  SpotifyProvider,
  type SpotifyConnectDeviceSummary,
} from './SpotifyProvider.js';

export type { SpotifyConnectDeviceSummary };

export interface SpotifyStatus {
  /** Un identifiant client est renseigné dans les réglages. */
  configured: boolean;
  /** Un jeton local (avec jeton de rafraîchissement) existe. */
  connected: boolean;
}

export type SpotifyConnectResult = { ok: true } | { ok: false; error: string };

/**
 * Point d'entrée unique de la commande Spotify côté processus principal :
 * mêmes rôles que `VoiceBridge` pour la voix — brancher une implémentation de
 * `@jarvis/core` (ici l'interface `MediaProvider`) sur l'IPC, en partageant
 * une seule instance de `SpotifyProvider` entre les outils (`spotify_*`) et
 * les réglages (statut, connexion, déconnexion), pour que jeton et état
 * d'authentification restent cohérents entre les deux.
 */
export class SpotifyBridge {
  private cached: { key: string; provider: SpotifyProvider } | null = null;
  private linked = false;

  /** Vrai après une connexion réussie. Le profil modeste s’en sert pour ne rien proposer avant. */
  connectedNow(): boolean {
    return this.linked;
  }

  constructor(private readonly getSettings: () => Settings) {}

  /** Utilisé par les outils : lève une erreur explicite si Spotify n'est pas configuré. */
  getProvider(): SpotifyProvider {
    const clientId = this.resolveClientId();
    if (!clientId) {
      throw new Error(
        "Spotify n'est pas configuré. Renseigne l'identifiant client Spotify dans les réglages de Jarvis.",
      );
    }
    return this.providerFor(clientId);
  }

  async status(clientIdOverride?: string): Promise<SpotifyStatus> {
    const clientId = this.resolveClientId(clientIdOverride);
    if (!clientId) {
      if (!clientIdOverride) this.linked = false;
      return { configured: false, connected: false };
    }
    const connected = await this.providerFor(clientId).isConnected();
    if (!clientIdOverride) this.linked = connected;
    return { configured: true, connected };
  }

  async connect(clientIdOverride?: string): Promise<SpotifyConnectResult> {
    const clientId = this.resolveClientId(clientIdOverride);
    if (!clientId) {
      return {
        ok: false,
        error: "Identifiant client Spotify manquant : renseigne-le d'abord dans les réglages.",
      };
    }
    try {
      await this.providerFor(clientId).connect();
      this.linked = true;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }

  async disconnect(clientIdOverride?: string): Promise<void> {
    const clientId = this.resolveClientId(clientIdOverride);
    if (!clientId) return;
    await this.providerFor(clientId).disconnect();
    if (!clientIdOverride) this.linked = false;
  }

  /** Appareils Spotify Connect visibles (onglet Spotify des réglages). */
  async listDevices(clientIdOverride?: string): Promise<SpotifyConnectDeviceSummary[]> {
    const clientId = this.resolveClientId(clientIdOverride);
    if (!clientId) return [];
    try {
      return await this.providerFor(clientId).listConnectDevices();
    } catch {
      return [];
    }
  }

  private resolveClientId(clientIdOverride?: string): string {
    return (clientIdOverride ?? this.getSettings().spotifyClientId).trim();
  }

  /** 5.0.69 : une enceinte Connect est choisie par défaut dans les réglages (`spotify_transfer` proposé). */
  speakerChosen(): boolean {
    return Boolean(this.getSettings().spotifyDeviceName?.trim());
  }

  /**
   * Noms d'appareils Connect connus sans appel réseau : l'enceinte des réglages et la dernière
   * liste vue (réglages, lecture). Pour « mets X sur la Devialet » dit à la voix.
   */
  knownDeviceNames(): string[] {
    const names = new Set<string>();
    const chosen = (this.getSettings().spotifyDeviceName ?? '').trim();
    if (chosen) names.add(chosen);
    for (const name of this.cached?.provider.lastSeenDeviceNames() ?? []) names.add(name);
    return [...names];
  }

  private providerFor(clientId: string): SpotifyProvider {
    const settings = this.getSettings();
    // Réglages facultatifs, sans défaut Zod : absents = bureau Windows et plafond 70.
    const targetDeviceName = (settings.spotifyDeviceName ?? '').trim();
    const speakerMaxVolume = settings.spotifySpeakerMaxVolume ?? DEFAULT_SPEAKER_MAX_VOLUME;
    const key = `${clientId}\0${targetDeviceName}\0${speakerMaxVolume}`;
    if (!this.cached || this.cached.key !== key) {
      this.cached = {
        key,
        provider: new SpotifyProvider(clientId, {
          targetDeviceName,
          speakerMaxVolume,
        }),
      };
    }
    return this.cached.provider;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
