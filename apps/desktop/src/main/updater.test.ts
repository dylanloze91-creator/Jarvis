import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const autoUpdater = Object.assign(new EventEmitter(), {
  checkForUpdates: vi.fn(async () => undefined),
  quitAndInstall: vi.fn(),
});

vi.mock('electron', () => ({ app: { getVersion: () => '0.4.10', isPackaged: true } }));
vi.mock('electron-updater', () => ({ autoUpdater }));

const { UpdateManager } = await import('./updater.js');

describe('mise à jour automatique', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('garde « Installer » après le téléchargement, même si le contrôle suivant échoue', async () => {
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new UpdateManager();
    autoUpdater.emit('update-downloaded', { version: '0.4.11' });

    await manager.checkNow();

    expect(manager.getState().phase).toBe('downloaded');
    expect(manager.getState().availableVersion).toBe('0.4.11');
    expect(fetchMock).not.toHaveBeenCalled();
    manager.quitAndInstall();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('lit latest.yml sans jeton et signale une version plus récente', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('version: 0.4.11\npath: Jarvis-Setup-0.4.11.exe\n', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const manager = new UpdateManager();

    await manager.checkNow();

    expect(manager.getState()).toMatchObject({ phase: 'available', availableVersion: '0.4.11' });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization/i);
  });
});
