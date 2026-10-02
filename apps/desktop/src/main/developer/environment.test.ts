import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findNpmCliOnPath, npmCliCandidates } from './environment.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-dev-env-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

function touch(path: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
  return path;
}

describe('npm sans shell : trouver npm-cli.js', () => {
  it('Windows : npm-cli.js à côté de node.exe (installation standard et nvm-windows)', () => {
    expect(npmCliCandidates('C:\\Program Files\\nodejs\\node.exe', 'win32')[0]).toMatch(
      /nodejs[\\/]node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/,
    );
  });

  it('Windows : repli sur le dossier de npm.cmd trouvé dans le PATH', () => {
    const dir = join(base, 'win', 'nodejs');
    const cli = touch(join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    expect(findNpmCliOnPath([join(base, 'vide'), dir].join(';'), 'win32')).toBe(cli);
  });

  it.skipIf(process.platform === 'win32')(
    'Linux / macOS : lien npm suivi jusqu’à npm-cli.js (nvm)',
    () => {
      const cli = touch(join(base, 'nvm', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
      const bin = join(base, 'nvm', 'bin');
      mkdirSync(bin, { recursive: true });
      symlinkSync(cli, join(bin, 'npm'));
      expect(findNpmCliOnPath([join(base, 'autre'), bin].join(':'), 'linux')).toBe(cli);
    },
  );

  it('introuvable : null, jamais d’exception', () => {
    expect(findNpmCliOnPath(join(base, 'rien'), process.platform)).toBeNull();
    expect(findNpmCliOnPath(undefined, 'win32')).toBeNull();
  });
});
