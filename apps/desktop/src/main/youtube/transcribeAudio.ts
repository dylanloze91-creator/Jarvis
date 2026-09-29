import { readFile } from 'node:fs/promises';
import { ipcMain, type WebContents } from 'electron';
import { randomId } from '@jarvis/core';
import {
  IpcChannel,
  type YoutubeTranscribeProgress,
  type YoutubeTranscribeResult,
} from '../../shared/ipc.js';

const LISTEN_TIMEOUT_MS = 3 * 60 * 60 * 1000;
/**
 * Le renderer annonce chaque tranche de 30 s. Sans nouvelle pendant ce délai
 * (fenêtre rechargée, Whisper bloqué), on abandonne au lieu de rester « en
 * cours » jusqu'à trois heures.
 */
export const LISTEN_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Envoie le fichier audio au renderer, qui le décode puis appelle le Whisper
 * local déjà utilisé pour la dictée (`transcribeWithWhisper`). Le fichier
 * lui-même est effacé par l'appelant.
 */
export function transcribeAudioFile(input: {
  webContents: WebContents | null;
  filePath: string;
  onProgress: (message: string) => void;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
}): Promise<string> {
  const webContents = input.webContents;
  if (!webContents || webContents.isDestroyed()) {
    return Promise.reject(new Error('fenêtre indisponible pour Whisper'));
  }

  const requestId = randomId();
  const idleTimeoutMs = input.idleTimeoutMs ?? LISTEN_IDLE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(new Error('écoute trop longue'))), LISTEN_TIMEOUT_MS);
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => finish(() => reject(new Error('Whisper ne répond plus'))),
        idleTimeoutMs,
      );
    };
    armIdle();

    const onProgress = (_event: Electron.IpcMainEvent, payload: YoutubeTranscribeProgress): void => {
      if (payload.requestId !== requestId) return;
      armIdle();
      input.onProgress(payload.message);
    };
    const onResult = (_event: Electron.IpcMainEvent, payload: YoutubeTranscribeResult): void => {
      if (payload.requestId !== requestId) return;
      if (payload.ok && payload.text) finish(() => resolve(payload.text ?? ''));
      else finish(() => reject(new Error(payload.error || 'transcription vide')));
    };
    const onAbort = (): void => finish(() => reject(new Error('écoute interrompue')));

    const finish = (done: () => void): void => {
      clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      ipcMain.removeListener(IpcChannel.youtubeTranscribeProgress, onProgress);
      ipcMain.removeListener(IpcChannel.youtubeTranscribeResult, onResult);
      input.signal?.removeEventListener('abort', onAbort);
      done();
    };

    ipcMain.on(IpcChannel.youtubeTranscribeProgress, onProgress);
    ipcMain.on(IpcChannel.youtubeTranscribeResult, onResult);
    input.signal?.addEventListener('abort', onAbort);

    void readFile(input.filePath)
      .then((bytes) => {
        if (webContents.isDestroyed()) {
          finish(() => reject(new Error('fenêtre fermée pendant l’écoute')));
          return;
        }
        webContents.send(IpcChannel.youtubeTranscribe, { requestId, bytes });
      })
      .catch((error: unknown) => {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      });
  });
}
