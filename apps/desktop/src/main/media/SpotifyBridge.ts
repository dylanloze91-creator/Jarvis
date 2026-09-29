import type { Settings } from '@jarvis/core';
import { SpotifyProvider } from './SpotifyProvider.js';

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
  private cached: { clientId: string; provider: SpotifyProvider } | null = null;

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
    if (!clientId) return { configured: false, connected: false };
    return { configured: true, connected: await this.providerFor(clientId).isConnected() };
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
      return { ok: true };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }

  async disconnect(clientIdOverride?: string): Promise<void> {
    const clientId = this.resolveClientId(clientIdOverride);
    if (!clientId) return;
    await this.providerFor(clientId).disconnect();
  }

  private resolveClientId(clientIdOverride?: string): string {
    return (clientIdOverride ?? this.getSettings().spotifyClientId).trim();
  }

  private providerFor(clientId: string): SpotifyProvider {
    if (!this.cached || this.cached.clientId !== clientId) {
      this.cached = { clientId, provider: new SpotifyProvider(clientId) };
    }
    return this.cached.provider;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
