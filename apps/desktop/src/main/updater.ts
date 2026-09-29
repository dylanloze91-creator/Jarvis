import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import {
  classifyUpdateError,
  githubLatestYmlUrl,
  interpretLatestYmlResponse,
} from '@jarvis/core';
import type { UpdateState } from '../shared/ipc.js';

/** Un contrôle au démarrage, un peu après (pas dès la seconde 0, pour laisser
 * l'application finir de s'installer avant de solliciter le réseau), puis un
 * contrôle périodique toutes les quatre heures. */
const INITIAL_CHECK_DELAY_MS = 15_000;
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Encapsule `electron-updater` pour Jarvis : vérification au démarrage puis
 * périodique, téléchargement en arrière-plan, jamais d'interruption forcée
 * — le redémarrage pour appliquer la mise à jour est toujours une action
 * explicite de l'utilisateur.
 *
 * La vérification manuelle (« Vérifier les mises à jour ») interroge d'abord
 * le `latest.yml` public GitHub, y compris en développement : ça permet
 * d'afficher un résultat honnête (à jour / disponible / échec et pourquoi)
 * même quand electron-updater n'a pas d'`app-update.yml`. Le téléchargement
 * et l'installation restent réservés à l'application packagée.
 */
export class UpdateManager {
  private state: UpdateState;
  private checking = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private initialCheckHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(state: UpdateState) => void>();

  constructor() {
    this.state = {
      currentVersion: app.getVersion(),
      phase: 'idle',
      canInstall: app.isPackaged,
    };

    if (!app.isPackaged) return;

    autoUpdater.disableWebInstaller = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.disableDifferentialDownload = false;

    autoUpdater.on('checking-for-update', () => {
      this.patch({ phase: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      this.patch({
        phase: 'downloading',
        availableVersion: info.version,
        feedStatus: 'ok',
        progress: undefined,
        errorMessage: undefined,
        errorKind: undefined,
      });
    });

    autoUpdater.on('update-not-available', () => {
      this.patch({
        phase: 'not-available',
        lastCheckedAt: Date.now(),
        feedStatus: this.state.feedStatus === 'empty' ? 'empty' : 'ok',
        errorMessage: undefined,
        errorKind: undefined,
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.patch({
        phase: 'downloading',
        progress: {
          percent: progress.percent,
          transferredBytes: progress.transferred,
          totalBytes: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        },
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.patch({
        phase: 'downloaded',
        availableVersion: info.version,
        progress: undefined,
        lastCheckedAt: Date.now(),
        feedStatus: 'ok',
        errorMessage: undefined,
        errorKind: undefined,
      });
    });

    autoUpdater.on('error', (error) => {
      this.checking = false;
      const failure = classifyUpdateError(error);
      if (failure.kind === 'not-found') {
        this.patch({
          phase: 'not-available',
          feedStatus: 'empty',
          lastCheckedAt: Date.now(),
          errorMessage: undefined,
          errorKind: undefined,
        });
        return;
      }
      this.patch({
        phase: 'error',
        errorMessage: failure.message,
        errorKind: failure.kind,
        lastCheckedAt: Date.now(),
      });
    });
  }

  getState(): UpdateState {
    return this.state;
  }

  onStateChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.initialCheckHandle = setTimeout(() => void this.checkNow(), INITIAL_CHECK_DELAY_MS);
    this.intervalHandle = setInterval(() => void this.checkNow(), PERIODIC_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    if (this.initialCheckHandle) clearTimeout(this.initialCheckHandle);
  }

  /**
   * Vérification manuelle (bouton des réglages) ou déclenchée par le cycle
   * périodique. Interroge GitHub d'abord pour un résultat honnête, puis
   * electron-updater seulement s'il y a réellement une version plus récente
   * et que l'application est packagée.
   */
  async checkNow(): Promise<void> {
    // Une mise à jour déjà téléchargée attend le clic « Installer » : un
    // nouveau contrôle (hors ligne par exemple) ferait disparaître ce bouton.
    if (this.checking || this.state.phase === 'downloaded') return;
    this.checking = true;
    this.patch({ phase: 'checking', errorMessage: undefined, errorKind: undefined });
    try {
      const feed = await this.probeFeed();
      const lastCheckedAt = Date.now();

      if (feed.kind === 'network') {
        this.patch({
          phase: 'error',
          errorKind: 'network',
          errorMessage: feed.message,
          lastCheckedAt,
        });
        return;
      }

      if (feed.kind === 'invalid') {
        this.patch({
          phase: 'error',
          errorKind: 'unknown',
          errorMessage: feed.message,
          lastCheckedAt,
        });
        return;
      }

      if (feed.kind === 'empty') {
        this.patch({
          phase: 'not-available',
          feedStatus: 'empty',
          lastCheckedAt,
          availableVersion: undefined,
          errorMessage: undefined,
          errorKind: undefined,
        });
        return;
      }

      if (feed.kind === 'current') {
        this.patch({
          phase: 'not-available',
          feedStatus: 'ok',
          lastCheckedAt,
          availableVersion: undefined,
          errorMessage: undefined,
          errorKind: undefined,
        });
        return;
      }

      this.patch({
        phase: 'available',
        availableVersion: feed.publishedVersion,
        feedStatus: 'ok',
        lastCheckedAt,
        errorMessage: undefined,
        errorKind: undefined,
      });

      if (!app.isPackaged) return;
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const failure = classifyUpdateError(error);
      if (failure.kind === 'not-found') {
        this.patch({
          phase: 'not-available',
          feedStatus: 'empty',
          lastCheckedAt: Date.now(),
          errorMessage: undefined,
          errorKind: undefined,
        });
        return;
      }
      this.patch({
        phase: 'error',
        errorMessage: failure.message,
        errorKind: failure.kind,
        lastCheckedAt: Date.now(),
      });
    } finally {
      this.checking = false;
    }
  }

  quitAndInstall(): void {
    if (this.state.phase !== 'downloaded' || !app.isPackaged) return;
    autoUpdater.quitAndInstall(true, true);
  }

  private async probeFeed(): Promise<
    | { kind: 'empty' }
    | { kind: 'current'; publishedVersion: string }
    | { kind: 'available'; publishedVersion: string }
    | { kind: 'network'; message: string }
    | { kind: 'invalid'; message: string }
  > {
    let response: Response;
    try {
      response = await fetch(githubLatestYmlUrl(), {
        cache: 'no-store',
        headers: { Accept: 'application/octet-stream', 'User-Agent': 'Jarvis-updater' },
      });
    } catch (error) {
      const failure = classifyUpdateError(error);
      return { kind: 'network', message: failure.message };
    }

    const body = await response.text().catch(() => '');
    const interpreted = interpretLatestYmlResponse(response.status, body, this.state.currentVersion);

    if (interpreted.kind === 'invalid') {
      return {
        kind: 'invalid',
        message:
          'La vérification des mises à jour a échoué pour une raison inattendue. Jarvis continue de fonctionner normalement.',
      };
    }
    if (interpreted.kind === 'empty') return { kind: 'empty' };
    if (interpreted.kind === 'current') {
      return { kind: 'current', publishedVersion: interpreted.publishedVersion! };
    }
    return { kind: 'available', publishedVersion: interpreted.publishedVersion! };
  }

  private patch(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }
}
