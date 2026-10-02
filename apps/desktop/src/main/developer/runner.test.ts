import { describe, expect, it } from 'vitest';
import { CommandRefusedError, displayCommand, refusalOf, runProcess } from './runner.js';

const node = process.execPath;

describe('lanceur de Jarvis Développeur', () => {
  it('lance un programme sans shell et rend sa sortie et son code', async () => {
    const outcome = await runProcess({
      program: node,
      args: ['-e', "process.stdout.write('a b'); process.exit(3)"],
      cwd: process.cwd(),
      timeoutMs: 20_000,
    });
    expect(outcome).toMatchObject({
      code: 3,
      stdout: 'a b',
      timedOut: false,
      cancelled: false,
      error: null,
    });
  });

  it('les métacaractères restent des arguments : rien n’est interprété', async () => {
    const outcome = await runProcess({
      program: node,
      args: ['-e', 'console.log(process.argv[1])', '&& echo pirate; rm -rf /'],
      cwd: process.cwd(),
      timeoutMs: 20_000,
      display: 'node --version',
    });
    expect(outcome.stdout.trim()).toBe('&& echo pirate; rm -rf /');
  });

  it('une commande refusée ne démarre jamais', async () => {
    await expect(
      runProcess({
        program: 'git',
        args: ['push', 'origin', 'main'],
        cwd: process.cwd(),
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(CommandRefusedError);
    await expect(
      runProcess({ program: 'npm', args: ['publish'], cwd: process.cwd(), timeoutMs: 1_000 }),
    ).rejects.toThrow(/refusée/);
  });

  it('l’affichage ne peut pas cacher la vraie commande', () => {
    expect(refusalOf({ program: 'git', args: ['push'] }, 'git status')?.[0]).toMatch(
      /n’est pas celle lancée/,
    );
    expect(
      refusalOf(
        { program: 'C:\\Program Files\\Git\\cmd\\git.exe', args: ['-c', 'x=y', 'push'] },
        'git status',
      ),
    ).not.toBeNull();
    expect(
      refusalOf(
        { program: node, args: ['C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'publish'] },
        'npm ci',
      )?.join(' '),
    ).toMatch(/publication/);
    expect(
      refusalOf(
        { program: 'git', args: ['-c', 'core.fsmonitor=false', 'grep', '-e', 'x'] },
        'git grep',
      ),
    ).toBeNull();
  });

  it('délai dépassé : le processus et ses enfants sont arrêtés', async () => {
    const script =
      "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1000);";
    const started = Date.now();
    const outcome = await runProcess({
      program: node,
      args: ['-e', script],
      cwd: process.cwd(),
      timeoutMs: 800,
      display: 'node --version',
    });
    expect(outcome.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    const grandchild = Number(outcome.stdout.trim());
    expect(grandchild).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const alive = (() => {
      try {
        process.kill(grandchild, 0);
        return true;
      } catch {
        return false;
      }
    })();
    expect(alive).toBe(false);
  });

  it('annulation par signal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const outcome = await runProcess({
      program: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      timeoutMs: 20_000,
      signal: controller.signal,
      display: 'node --version',
    });
    expect(outcome.cancelled).toBe(true);
  });

  it('programme introuvable : erreur claire, pas d’exception', async () => {
    const outcome = await runProcess({
      program: 'jarvis-programme-inexistant',
      args: [],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    expect(outcome.error).toMatch(/ENOENT/);
  });

  it('sortie bornée : seule la fin est gardée, lignes transmises au fil de l’eau', async () => {
    const lines: string[] = [];
    const outcome = await runProcess({
      program: node,
      args: ['-e', "for (let i = 0; i < 5000; i++) console.log('ligne ' + i)"],
      cwd: process.cwd(),
      timeoutMs: 20_000,
      maxBytes: 1_000,
      onLine: (line) => lines.push(line),
      display: 'node --version',
    });
    expect(outcome.truncated).toBe(true);
    expect(outcome.stdout.length).toBeLessThanOrEqual(1_000);
    expect(outcome.stdout.trim().endsWith('ligne 4999')).toBe(true);
    expect(lines).toHaveLength(5000);
  });

  it('affichage des arguments avec espaces', () => {
    expect(
      displayCommand('C:\\Program Files\\Git\\cmd\\git.exe', [
        'clone',
        'https://x',
        'C:\\dev\\Mon Jarvis',
      ]),
    ).toBe('git.exe clone https://x "C:\\dev\\Mon Jarvis"');
  });
});
