/**
 * Morceau identifié chez un fournisseur média (Spotify aujourd'hui, d'autres
 * services de lecture demain). `provider` permet à l'interface d'afficher la
 * source sans que l'outil ait besoin de le savoir.
 */
export interface MediaTrack {
  uri: string;
  title: string;
  artists: string[];
  album?: string;
  /** URI d'album / artiste, pour lancer un contexte si le bureau ignore un morceau isolé. */
  contextUri?: string;
  artistUri?: string;
  provider: string;
}

export interface PlaybackState {
  isPlaying: boolean;
  track?: MediaTrack;
  deviceName?: string;
  volumePercent?: number;
}

/**
 * 5.0.69 — où la lecture a été vérifiée. `targeted` : un appareil précis était demandé
 * (réglage ou voix) ; l'outil dit alors où ça joue. Un fournisseur peut ne rien renvoyer.
 */
export interface PlayedOn {
  deviceName: string;
  deviceType: string;
  targeted: boolean;
}

/**
 * Contrat que tout fournisseur de lecture média doit respecter — même
 * principe que `SearchProvider` ou `MarketDataProvider` : les outils
 * (`spotify_play`, etc.) ne connaissent que cette interface, jamais
 * l'implémentation concrète. Cette abstraction vit dans `packages/core` sans
 * dépendre d'Electron ni de Node ; l'implémentation Spotify, elle, a besoin
 * des deux (serveur HTTP local pour l'OAuth, ouverture du navigateur système,
 * stockage du jeton sur disque) et reste donc côté `apps/desktop`.
 */
export interface MediaProvider {
  readonly id: string;
  searchTrack(query: string): Promise<MediaTrack | null>;
  play(trackUri?: string): Promise<void | PlayedOn>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  setVolume(percent: number): Promise<void>;
  setShuffle(enabled: boolean): Promise<void>;
  getPlaybackState(): Promise<PlaybackState | null>;
}
