import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@jarvis/core';

/**
 * Revue 5.0.64, point 5 : `close_application` sous Windows attend tous les
 * processus avec UN SEUL délai partagé, et une erreur d'accès (processus lancé en
 * administrateur) est rapportée, jamais levée. PowerShell n'est jamais lancé ici :
 * `spawn` est simulé, les minuteries sont factices, le script est relu tel quel.
 */

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  pid = 777;
}

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, shell: { openPath: vi.fn() } }));
vi.mock('../media/launchSpotifyDesktop.js', () => ({
  launchSpotifyDesktop: vi.fn(),
  windowsSpotifyExeCandidates: vi.fn(() => []),
}));

const {
  CLOSE_WINDOWS_SCRIPT_MARGIN_MS,
  CLOSE_WINDOWS_WAIT_MS,
  buildCloseWindowsScript,
  closeApplicationTool,
  closeWindows,
  describeCloseResult,
} = await import('./applications.js');

const context: ToolContext = { requestConfirmation: async () => true };
const originalPlatform = process.platform;

function powershellCalls() {
  return spawnMock.mock.calls.filter((call) => call[0] === 'powershell.exe');
}

function scriptOf(call: unknown[]): string {
  const args = call[1] as string[];
  return args.at(-1) ?? '';
}

function reply(child: FakeChild, stdout: string, code = 0) {
  child.stdout.emit('data', Buffer.from(stdout, 'utf8'));
  child.emit('close', code, null);
}

describe('close_application (Windows simulé) : délai partagé et accès refusé', () => {
  let child: FakeChild;

  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
    child = new FakeChild();
    spawnMock.mockImplementation(() => child);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('un seul PowerShell et un seul délai pour tous les processus, quel que soit leur nombre', async () => {
    const pending = closeWindows('Discord', false);
    await vi.advanceTimersByTimeAsync(0);

    expect(powershellCalls()).toHaveLength(1);
    const script = scriptOf(powershellCalls()[0]!);
    expect(
      script.match(/\$deadline = \[DateTime\]::UtcNow\.AddMilliseconds\(5000\)/g),
    ).toHaveLength(1);
    expect(script).toMatch(/UtcNow -ge \$deadline/);
    expect(script).not.toMatch(/WaitForExit/);
    expect(script).toMatch(/Start-Sleep -Milliseconds 200/);

    // Huit processus Discord : le délai partagé n'est pas multiplié par huit.
    await vi.advanceTimersByTimeAsync(CLOSE_WINDOWS_WAIT_MS + CLOSE_WINDOWS_SCRIPT_MARGIN_MS - 1);
    expect(child.kill).not.toHaveBeenCalled();
    reply(child, 'GONE=Discord\nSTILL=\nDENIED=\n');

    await expect(pending).resolves.toEqual({ ok: true, content: 'Fermé : Discord' });
    expect(powershellCalls()).toHaveLength(1);
  });

  it('le délai partagé dépassé est dit comme tel, jamais « aucun processus »', async () => {
    const pending = closeWindows('Teams', false);
    await vi.advanceTimersByTimeAsync(CLOSE_WINDOWS_WAIT_MS + CLOSE_WINDOWS_SCRIPT_MARGIN_MS - 1);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', null, 'SIGTERM');

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/dépassé le délai \(15 s\)/);
    expect(result.content).not.toMatch(/Aucun processus/);
  });

  it('le script attrape les erreurs d’accès au lieu de les laisser arrêter le script', () => {
    const script = buildCloseWindowsScript('Teams', 'Teams', false);
    expect(script).toMatch(
      /function Test-Exited\(\$proc\) \{\s*try \{ return \[bool\]\$proc\.HasExited \} catch \{ return \$null \}/,
    );
    expect(script).toMatch(
      /try \{\s*if \(\$false\) \{\s*Stop-Process -Id \$p\.Id -Force -ErrorAction Stop/,
    );
    expect(script).toMatch(
      /\} catch \{\s*if \(\(Test-Exited \$p\) -ne \$true\) \{ \$denied\[\$p\.Id\] = \$p\.ProcessName \}/,
    );
    expect(script).not.toMatch(/SilentlyContinue/);
    expect(script).toMatch(/^'DENIED=' \+ /m);

    const forced = buildCloseWindowsScript('Teams', 'Teams', true);
    expect(forced).toMatch(/if \(\$true\) \{\s*Stop-Process -Id \$p\.Id -Force -ErrorAction Stop/);
  });

  it('un processus en accès refusé est rapporté, sans exception, et n’est pas « fermé »', async () => {
    const pending = closeWindows('Teams', false);
    await vi.advanceTimersByTimeAsync(0);
    reply(child, 'GONE=\nSTILL=\nDENIED=Teams\n');

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/Accès refusé pour « Teams »/);
    expect(result.content).toMatch(/administrateur/);
    expect(result.content).not.toMatch(/^Fermé/);
  });

  it('fermés, encore ouverts et refusés sont tous dits dans la même réponse', () => {
    const mixed = describeCloseResult('Discord', 'GONE=Discord\nSTILL=Teams\nDENIED=Code\n');
    expect(mixed.ok).toBe(false);
    expect(mixed.content).toMatch(/« Teams » est toujours ouvert/);
    expect(mixed.content).toMatch(/Accès refusé pour « Code »/);
    expect(mixed.content).toMatch(/Fermé : Discord\./);

    expect(describeCloseResult('notepad', 'GONE=notepad\nSTILL=\nDENIED=\n')).toEqual({
      ok: true,
      content: 'Fermé : notepad',
    });
  });

  it('un script qui lève « introuvable » (code ≠ 0, sans délai dépassé) reste « aucun processus »', async () => {
    const pending = closeWindows('Inconnu', false);
    await vi.advanceTimersByTimeAsync(0);
    reply(child, '', 1);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      content: expect.stringMatching(/Aucun processus/),
    });
  });

  it('par l’outil, sous Windows : même script, même délai partagé, nom jamais entre guillemets doubles', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const name = 'Visual Studio Code';
    const pending = closeApplicationTool.run({ name }, context);
    await vi.advanceTimersByTimeAsync(0);

    expect(powershellCalls()).toHaveLength(1);
    const script = scriptOf(powershellCalls()[0]!);
    expect(script).toContain(`'${name}'`);
    expect(script).not.toMatch(/-like\s+"/);
    expect(script).toContain(`AddMilliseconds(${CLOSE_WINDOWS_WAIT_MS})`);

    reply(child, 'GONE=Code\nSTILL=\nDENIED=\n');
    await expect(pending).resolves.toMatchObject({ ok: true, content: 'Fermé : Code' });
  });
});
