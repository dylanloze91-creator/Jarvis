import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('electron-builder Piper extraResources', () => {
  it('exclut le dossier cache/ des archives Piper (~25 Mo inutiles)', () => {
    const yaml = readFileSync(join(import.meta.dirname, 'electron-builder.yml'), 'utf8');
    expect(yaml).toMatch(/from: voice-assets\/piper/);
    expect(yaml).toContain('!cache/**');
  });

  it('package:win force JARVIS_PIPER_TARGET=win-x64 et vérifie le bundle Windows', () => {
    const pkg = readFileSync(join(import.meta.dirname, 'package.json'), 'utf8');
    expect(pkg).toContain('JARVIS_PIPER_TARGET=win-x64');
    expect(pkg).toContain('verify-piper-windows-bundle.mjs');
  });
});
