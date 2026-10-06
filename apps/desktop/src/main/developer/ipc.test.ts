import { describe, expect, it } from 'vitest';
import {
  InMemoryAuditLogStore,
  createDefaultRegistry,
  parseSettings,
  type Settings,
} from '@jarvis/core';
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
      registry: createDefaultRegistry(),
      userDataPath: () => 'C:\\Users\\dex\\AppData\\Roaming\\Jarvis',
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
    for (const [channel, ...args] of [
      [DeveloperChannel.hardware],
      [DeveloperChannel.calibrate, 'qwen2.5:3b'],
      [DeveloperChannel.validateConfig, 'qwen3.6:35b-a3b-coding', true],
      [DeveloperChannel.experts, true],
      [DeveloperChannel.pull, 'qwen3.6:35b-a3b-coding'],
      [DeveloperChannel.refreshOllamaModels],
      [DeveloperChannel.pullOllamaModel, 'deepseek-coder-v2:16b'],
      [DeveloperChannel.projectChatOpen, 'jarvis'],
      [DeveloperChannel.projectChatSend, 'jarvis', 'salut'],
      [DeveloperChannel.benchmark, 'qwen3.6:35b-a3b-coding'],
    ] as const) {
      const state = await ipc.invoke(channel, ...args);
      expect(state.notice).toMatch(/coupé/);
      expect(state.model.validation).toBeNull();
      expect(state.model.experts.changes.map((change) => change.name)).toEqual([
        'LLAMA_ARG_CPU_MOE',
        'GGML_CUDA_NO_PINNED',
      ]);
    }
    for (const [channel, ...args] of [
      [DeveloperChannel.taskStart, 'Ajoute un outil qui donne la version.'],
      [DeveloperChannel.taskApprove, true],
      [DeveloperChannel.taskRollback, 'abcdef1'],
      [DeveloperChannel.taskDiscard],
      [DeveloperChannel.taskKeep],
      [DeveloperChannel.sandboxes],
      [DeveloperChannel.sandboxesClean, ['C:\\dev\\Jarvis-taches\\x']],
    ] as const) {
      const state = await ipc.invoke(channel, ...args);
      expect(state.notice).toMatch(/coupé/);
      expect(state.codeTask).toBeNull();
      expect(state.sandboxes).toBeNull();
    }
    expect(registered.current()).toBeNull();

    settings = parseSettings({ developer: { enabled: true } });
    expect((await ipc.invoke(DeveloperChannel.status)).enabled).toBe(true);
    expect(registered.current()).not.toBeNull();
  });
});
