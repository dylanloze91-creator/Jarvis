import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const { POWERSHELL_UTF8_PREAMBLE, runPowerShell } = await import('./exec.js');

describe('runPowerShell (simulé, non exécuté sur Windows)', () => {
  it('force la sortie UTF-8 et retire un éventuel BOM', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const pending = runPowerShell('Get-Process');
    child.stdout.emit('data', Buffer.from('\uFEFFFenêtre « Café »', 'utf8'));
    child.emit('close', 0, null);
    const result = await pending;

    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnMock.mock.calls[0]?.[0]).toBe('powershell.exe');
    expect(args.at(-1)).toBe(`${POWERSHELL_UTF8_PREAMBLE}\nGet-Process`);
    expect(result.stdout).toBe('Fenêtre « Café »');
  });
});
