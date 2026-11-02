import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const ipcMain = new EventEmitter();
vi.mock('electron', () => ({ ipcMain }));

const { transcribeViaRenderer } = await import('./transcribe.js');
const { IpcChannel } = await import('../../shared/ipc.js');

function fakeWindow(onSend: (payload: { requestId: string }) => void): Electron.WebContents {
  return {
    isDestroyed: () => false,
    send: (_channel: string, payload: { requestId: string }) => onSend(payload),
  } as unknown as Electron.WebContents;
}

/**
 * 5.0.64 (revue, point 6) — la transcription d'une enceinte passe par la fenêtre principale ;
 * une réponse envoyée par une autre page (aperçu, indicateur, page tierce) ne compte pas.
 */
describe('transcription des enceintes par la fenêtre', () => {
  it('n’accepte la réponse que de la fenêtre interrogée', async () => {
    let requestId = '';
    const main = fakeWindow((payload) => {
      requestId = payload.requestId;
    });
    const other = fakeWindow(() => undefined);
    const pending = transcribeViaRenderer({ webContents: main, pcm: new Float32Array(16), timeoutMs: 500 });
    await Promise.resolve();
    expect(requestId).not.toBe('');

    ipcMain.emit(IpcChannel.speakerTranscribeResult, { sender: other }, { requestId, text: 'intrus' });
    ipcMain.emit(IpcChannel.speakerTranscribeResult, { sender: main }, { requestId: 'autre', text: 'mauvaise demande' });
    expect(ipcMain.listenerCount(IpcChannel.speakerTranscribeResult)).toBe(1);

    ipcMain.emit(IpcChannel.speakerTranscribeResult, { sender: main }, { requestId, text: 'Jarvis bonjour' });
    await expect(pending).resolves.toBe('Jarvis bonjour');
    expect(ipcMain.listenerCount(IpcChannel.speakerTranscribeResult)).toBe(0);
  });

  it('erreur rapportée par la fenêtre, ou silence : la promesse échoue et rien ne traîne', async () => {
    let requestId = '';
    const main = fakeWindow((payload) => {
      requestId = payload.requestId;
    });
    const failing = transcribeViaRenderer({ webContents: main, pcm: new Float32Array(16), timeoutMs: 500 });
    await Promise.resolve();
    ipcMain.emit(IpcChannel.speakerTranscribeResult, { sender: main }, { requestId, error: 'modèle absent' });
    await expect(failing).rejects.toThrow('modèle absent');

    const silent = transcribeViaRenderer({ webContents: fakeWindow(() => undefined), pcm: new Float32Array(16), timeoutMs: 30 });
    await expect(silent).rejects.toThrow('Whisper ne répond pas');
    expect(ipcMain.listenerCount(IpcChannel.speakerTranscribeResult)).toBe(0);
  });
});
