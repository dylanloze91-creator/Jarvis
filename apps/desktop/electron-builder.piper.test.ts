import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('electron-builder Piper extraResources', () => {
  it('exclut le dossier cache/ des archives Piper (~25 Mo inutiles)', () => {
    const yaml = readFileSync(join(import.meta.dirname, 'electron-builder.yml'), 'utf8');
    expect(yaml).toMatch(/from: voice-assets\/piper/);
    expect(yaml).toContain('!cache/**');
  });

  it('package:win prend le binaire Windows par --target (portable sous cmd.exe) et vérifie le bundle', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const script = pkg.scripts['package:win']!;
    expect(script).toContain('setup-piper.mjs --target win-x64');
    expect(script).toContain('verify-piper-windows-bundle.mjs');
    // Une variable préfixée (VAR=valeur commande) échoue sous cmd.exe, où npm lance les scripts sous Windows.
    expect(script).not.toMatch(/(^|&&\s*)[A-Z_]+=\S+\s/);
  });

  it("n'embarque pas le binaire Linux dans l'installateur Windows", () => {
    const yaml = readFileSync(join(import.meta.dirname, 'electron-builder.yml'), 'utf8');
    expect(yaml).toContain('!bin/linux-x64/**');
  });
});
