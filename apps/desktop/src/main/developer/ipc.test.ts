import { describe, expect, it } from 'vitest';
import { InMemoryAuditLogStore, parseSettings, type Settings } from '@jarvis/core';
import { DeveloperChannel, type DeveloperState } from '../../shared/developerIpc.js';
import { registerDeveloperIpc } from './ipc.js';

function fakeIpc() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    } as never,
    invoke: (channel: string, ...args: unknown[]) =>
      Promise.resolve(handlers.get(channel)!({}, ...args)) as Promise<DeveloperState>,
  };
}

describe('canaux dev:*', () => {
  it('mode coupé : aucune session créée, chaque action répond « coupé »', async () => {
    let settings: Settings = parseSettings({});
    const ipc = fakeIpc();
    const registered = registerDeveloperIpc(ipc.ipcMain, {
      getSettings: () => settings,
      appVersion: () => '0.4.23',
      platform: 'win32',
      home: 'C:\\Users\\dex',
      logsDir: () => 'C:\\logs',
      oneDriveRoots: () => [],
      auditLog: new InMemoryAuditLogStore(),
      target: () => null,
    });
    expect([...ipc.handlers.keys()].every((channel) => channel.startsWith('dev:'))).toBe(true);
    expect((await ipc.invoke(DeveloperChannel.status)).enabled).toBe(false);
    expect((await ipc.invoke(DeveloperChannel.status)).suggestedPath).toBe('C:\\dev\\Jarvis');
    for (const channel of [
      DeveloperChannel.detect,
      DeveloperChannel.environment,
      DeveloperChannel.install,
      DeveloperChannel.analyze,
    ]) {
      const state = await ipc.invoke(channel);
      expect(state.enabled).toBe(false);
      expect(state.notice).toMatch(/coupé/);
    }
    expect((await ipc.invoke(DeveloperChannel.clone, 'C:\\dev\\Jarvis')).notice).toMatch(/coupé/);
    expect(registered.current()).toBeNull();

    settings = parseSettings({ developer: { enabled: true } });
    expect((await ipc.invoke(DeveloperChannel.status)).enabled).toBe(true);
    expect(registered.current()).not.toBeNull();
  });
});
