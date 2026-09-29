import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const ipcMain = new EventEmitter();
vi.mock('electron', () => ({ ipcMain }));

const { transcribeAudioFile } = await import('./transcribeAudio.js');
const { IpcChannel } = await import('../../shared/ipc.js');

const dir = await mkdtemp(join(tmpdir(), 'jarvis-yt-test-'));
const filePath = join(dir, 'piste');
await writeFile(filePath, Buffer.from([1, 2, 3]));

function fakeWebContents(onSend: (payload: { requestId: string }) => void) {
  return {
    isDestroyed: () => false,
    send: (_channel: string, payload: { requestId: string }) => onSend(payload),
  } as unknown as Electron.WebContents;
}

describe('écoute YouTube par Whisper (renderer)', () => {
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('abandonne si le renderer ne répond plus, au lieu de rester en cours', async () => {
    const pending = transcribeAudioFile({
      webContents: fakeWebContents(() => undefined),
      filePath,
      onProgress: () => undefined,
      idleTimeoutMs: 40,
    });
    await expect(pending).rejects.toThrow(/ne répond plus/);
    expect(ipcMain.listenerCount(IpcChannel.youtubeTranscribeResult)).toBe(0);
  });

  it('chaque progression repousse le délai, puis rend le texte', async () => {
    const progress: string[] = [];
    const pending = transcribeAudioFile({
      webContents: fakeWebContents(({ requestId }) => {
        let step = 0;
        const tick = setInterval(() => {
          step += 1;
          if (step < 4) {
            ipcMain.emit(IpcChannel.youtubeTranscribeProgress, {}, {
              requestId,
              message: `partie ${step}`,
            });
          } else {
            clearInterval(tick);
            ipcMain.emit(IpcChannel.youtubeTranscribeResult, {}, {
              requestId,
              ok: true,
              text: 'Bonjour.',
            });
          }
        }, 25);
      }),
      filePath,
      onProgress: (message) => progress.push(message),
      idleTimeoutMs: 60,
    });
    await expect(pending).resolves.toBe('Bonjour.');
    expect(progress).toEqual(['partie 1', 'partie 2', 'partie 3']);
  });
});
