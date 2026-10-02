import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { classifyCommand, type CommandSafetyLevel } from '@jarvis/core';
import { displayCommand, runProcess, type Runner } from '../runner.js';
import {
  SandboxError,
  createSandbox,
  defaultWorktreeRoot,
  discardCommands,
  listSandboxes,
} from './sandbox.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-sandbox-'));
const repo = join(base, 'Jarvis');
const root = defaultWorktreeRoot(repo);
afterAll(() => rmSync(base, { recursive: true, force: true }));

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

mkdirSync(join(repo, 'src'), { recursive: true });
writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
sh(repo, 'init', '-q', '-b', 'main');
sh(repo, 'add', '-A');
sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'départ');

const ran: Array<{ display: string; level: CommandSafetyLevel }> = [];
const run: Runner = (spec) => {
  const display = spec.display ?? displayCommand(spec.program, spec.args);
  ran.push({ display, level: classifyCommand(display, spec.context ?? {}).level });
  return runProcess(spec);
};
const deps = { run, repoRoot: repo, root, freeBytes: async () => 50e9 };

describe('copie isolée : worktree git jarvis-dev/*', () => {
  it('dossier par défaut à côté de la copie de travail', () => {
    expect(root).toBe(join(base, 'Jarvis-taches'));
  });

  it('refuse une branche hors jarvis-dev/*, un dossier dans la copie, et un disque trop plein', async () => {
    await expect(createSandbox(deps, 'main', 'x')).rejects.toBeInstanceOf(SandboxError);
    await expect(createSandbox(deps, 'jarvis-dev/2026-10-02-x', '../Jarvis/x')).rejects.toThrow(
      /Dossier refusé/,
    );
    await expect(
      createSandbox({ ...deps, freeBytes: async () => 1e9 }, 'jarvis-dev/2026-10-02-x', 'x'),
    ).rejects.toThrow(/Pas assez de place/);
    expect(sh(repo, 'worktree', 'list')).not.toContain('jarvis-dev');
  });

  it('crée, enregistre des points de reprise, compare, revient en arrière et jette — copie de l’utilisateur intacte', async () => {
    const sandbox = await createSandbox(deps, 'jarvis-dev/2026-10-02-essai', '2026-10-02-essai');
    expect(sandbox.path).toBe(join(root, '2026-10-02-essai'));
    expect(sh(sandbox.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(
      'jarvis-dev/2026-10-02-essai',
    );
    expect(await sandbox.checkpoint('rien')).toBeNull();

    writeFileSync(join(sandbox.path, 'src', 'a.ts'), 'export const a = 2;\n');
    writeFileSync(join(sandbox.path, 'src', 'b.ts'), 'export const b = 1;\n');
    const first = await sandbox.checkpoint('Modification');
    expect(first?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sh(sandbox.path, 'log', '-1', '--format=%an|%s').trim()).toBe(
      'Jarvis Développeur|Jarvis Développeur : Modification',
    );
    writeFileSync(join(sandbox.path, 'src', 'c.ts'), 'export const c = 1;\n');
    const diff = await sandbox.diff();
    expect(diff).toContain('+++ b/src/b.ts');
    expect(diff).toContain('+++ b/src/c.ts');
    expect(diff).toContain('-export const a = 1;');

    await sandbox.rollback(first!.sha);
    expect(existsSync(join(sandbox.path, 'src', 'c.ts'))).toBe(false);
    expect(readFileSync(join(sandbox.path, 'src', 'a.ts'), 'utf8')).toBe('export const a = 2;\n');

    mkdirSync(join(sandbox.path, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(sandbox.path, 'node_modules', 'x', 'i.js'), '1');
    const listed = await listSandboxes(run, repo, root);
    expect(listed).toEqual([
      expect.objectContaining({ branch: 'jarvis-dev/2026-10-02-essai', missing: false }),
    ]);
    expect(discardCommands(sandbox.path, sandbox.branch)).toHaveLength(5);
    await sandbox.discard();
    expect(existsSync(sandbox.path)).toBe(false);
    expect(sh(repo, 'branch', '--list', 'jarvis-dev/*').trim()).toBe('');
    expect(sh(repo, 'status', '--porcelain').trim()).toBe('');
    expect(readFileSync(join(repo, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(sh(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
  });

  it('chaque commande passe par le tri, aucune n’est refusée, et les destructrices sont toujours confirmées', () => {
    expect(ran.some((r) => r.level === 'denied')).toBe(false);
    const level = (prefix: string) => ran.find((r) => r.display.startsWith(prefix))?.level;
    expect(level('git worktree add -b jarvis-dev/')).toBe('confirm');
    expect(level('git commit --no-verify')).toBe('confirm');
    expect(level('git reset --hard')).toBe('always-confirm');
    expect(level('git clean -fd')).toBe('always-confirm');
    expect(level('git branch -D jarvis-dev/')).toBe('always-confirm');
    expect(level('git worktree remove')).toBe('always-confirm');
    expect(ran.some((r) => /push|publish/.test(r.display))).toBe(false);
  });

  it('les mêmes commandes destructrices sont refusées hors de la copie isolée', () => {
    expect(
      classifyCommand('git reset --hard', { insideSandbox: false, branch: 'main' }).level,
    ).toBe('denied');
    expect(classifyCommand('git branch -D jarvis-dev/x', { branch: 'main' }).level).toBe('denied');
    expect(classifyCommand('git reset --hard', { insideSandbox: true, branch: 'main' }).level).toBe(
      'denied',
    );
  });
});
