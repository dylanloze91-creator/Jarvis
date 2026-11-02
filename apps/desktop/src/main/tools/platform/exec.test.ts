import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  constructor(public pid: number | undefined = 4242) {
    super();
  }
}

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const { KILL_GRACE_MS, POWERSHELL_UTF8_PREAMBLE, run, runPowerShell } = await import('./exec.js');

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

/**
 * Revue 5.0.64, point 4 : à l'expiration du délai, sous Windows, `taskkill /T /F`
 * part en premier (le parent existe encore, donc toute l'arborescence est trouvée) ;
 * si taskkill échoue, le chemin d'avant (SIGTERM puis SIGKILL). Hors Windows, rien
 * ne change. Tout est simulé : aucun processus réel, aucun vrai taskkill.
 */
describe('run : dépassement de délai (processus simulés, minuteries factices)', () => {
  const originalPlatform = process.platform;
  let child: FakeChild;
  let taskkill: FakeChild;
  const taskkillCalls = () => spawnMock.mock.calls.filter((call) => call[0] === 'taskkill');

  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
    child = new FakeChild(4242);
    taskkill = new FakeChild(99);
    spawnMock.mockImplementation((command: string) => (command === 'taskkill' ? taskkill : child));
  });

  afterEach(() => {
    vi.useRealTimers();
    setPlatform(originalPlatform);
  });

  it('Windows : taskkill /T /F est lancé AVANT tout signal, et un taskkill réussi suffit', async () => {
    setPlatform('win32');
    const pending = run('cmd.exe', ['/c', 'ping localhost -n 60'], { timeoutMs: 500 });

    await vi.advanceTimersByTimeAsync(499);
    expect(taskkillCalls()).toHaveLength(0);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(taskkillCalls()).toHaveLength(1);
    expect(taskkillCalls()[0]?.[1]).toEqual(['/PID', '4242', '/T', '/F']);
    expect(taskkillCalls()[0]?.[2]).toMatchObject({ windowsHide: true, stdio: 'ignore' });
    expect(child.kill).not.toHaveBeenCalled();

    taskkill.emit('close', 0, null);
    child.emit('close', 1, null);
    const result = await pending;

    expect(result.timedOut).toBe(true);
    expect(result.code).toBe(1);
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS * 3);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('Windows : taskkill qui échoue (code ≠ 0) → repli SIGTERM puis SIGKILL une seconde plus tard', async () => {
    setPlatform('win32');
    const pending = run('cmd.exe', ['/c', 'ping'], { timeoutMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    expect(taskkillCalls()).toHaveLength(1);
    expect(child.kill).not.toHaveBeenCalled();

    taskkill.emit('close', 128, null);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS - 1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');

    child.emit('close', null, 'SIGKILL');
    const result = await pending;
    expect(result).toMatchObject({ timedOut: true, code: null, signal: 'SIGKILL' });
    expect(taskkillCalls()).toHaveLength(1);
  });

  it('Windows : taskkill introuvable (erreur de lancement) → même repli, sans SIGKILL si SIGTERM suffit', async () => {
    setPlatform('win32');
    const pending = run('cmd.exe', ['/c', 'ping'], { timeoutMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    taskkill.emit('error', new Error('spawn taskkill ENOENT'));
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGTERM');

    child.emit('close', null, 'SIGTERM');
    const result = await pending;
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS * 2);

    expect(result).toMatchObject({ timedOut: true, signal: 'SIGTERM' });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('Windows : taskkill « ok » mais processus toujours là → SIGKILL de sécurité, jamais pendu', async () => {
    setPlatform('win32');
    const pending = run('cmd.exe', ['/c', 'ping'], { timeoutMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    taskkill.emit('close', 0, null);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');

    child.emit('close', null, 'SIGKILL');
    await expect(pending).resolves.toMatchObject({ timedOut: true });
  });

  it('hors Windows : aucun taskkill, SIGTERM puis SIGKILL une seconde plus tard (comportement inchangé)', async () => {
    setPlatform('linux');
    const pending = run('sleep', ['60'], { timeoutMs: 200 });

    await vi.advanceTimersByTimeAsync(200);
    expect(taskkillCalls()).toHaveLength(0);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    expect(taskkillCalls()).toHaveLength(0);

    child.emit('close', null, 'SIGKILL');
    const result = await pending;
    expect(result).toMatchObject({ timedOut: true, signal: 'SIGKILL' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('hors Windows : un processus qui s’arrête sur SIGTERM n’est pas SIGKILLé', async () => {
    setPlatform('linux');
    const pending = run('sleep', ['60'], { timeoutMs: 200 });

    await vi.advanceTimersByTimeAsync(200);
    child.emit('close', null, 'SIGTERM');
    const result = await pending;
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS * 2);

    expect(result).toMatchObject({ timedOut: true, signal: 'SIGTERM' });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('une commande qui finit à temps n’est jamais tuée, sur aucune plateforme', async () => {
    setPlatform('win32');
    const pending = run('cmd.exe', ['/c', 'echo ok'], { timeoutMs: 1_000 });

    child.stdout.emit('data', Buffer.from('ok'));
    child.emit('close', 0, null);
    const result = await pending;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(result).toMatchObject({ timedOut: false, code: 0, stdout: 'ok' });
    expect(child.kill).not.toHaveBeenCalled();
    expect(taskkillCalls()).toHaveLength(0);
  });
});
