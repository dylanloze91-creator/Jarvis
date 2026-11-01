import { ipcMain, type WebContents } from 'electron';
import { SPEAKER_TRANSCRIBE_TIMEOUT_MS, randomId } from '@jarvis/core';
import { IpcChannel, type SpeakerTranscribeResult } from '../../shared/ipc.js';

/**
 * 5.0.64 — Whisper tourne dans le renderer (`voice/whisper/pipelineLoader.ts`), pas dans le
 * processus principal. Aller-retour IPC étroit : `speaker:transcribe-request { requestId, pcm }`
 * vers la fenêtre, `speaker:transcribe-result { requestId, text | error }` en retour. La fenêtre
 * peut être masquée (`backgroundThrottling: false`). Sans réponse dans le délai : erreur, le pont
 * répond 503 à l'enceinte.
 */
export function transcribeViaRenderer(input: {
  webContents: WebContents | null;
  pcm: Float32Array;
  timeoutMs?: number;
}): Promise<string> {
  const webContents = input.webContents;
  if (!webContents || webContents.isDestroyed()) {
    return Promise.reject(new Error('fenêtre indisponible pour Whisper'));
  }
  const requestId = randomId();
  const timeoutMs = input.timeoutMs ?? SPEAKER_TRANSCRIBE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const finish = (done: () => void): void => {
      clearTimeout(timer);
      ipcMain.removeListener(IpcChannel.speakerTranscribeResult, onResult);
      done();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('Whisper ne répond pas'))), timeoutMs);
    const onResult = (_event: Electron.IpcMainEvent, payload: SpeakerTranscribeResult): void => {
      if (!payload || payload.requestId !== requestId) return;
      if (typeof payload.text === 'string') finish(() => resolve(payload.text ?? ''));
      else finish(() => reject(new Error(payload.error || 'transcription impossible')));
    };
    ipcMain.on(IpcChannel.speakerTranscribeResult, onResult);
    try {
      webContents.send(IpcChannel.speakerTranscribeRequest, { requestId, pcm: input.pcm });
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}
