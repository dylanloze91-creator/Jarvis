import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('electron-builder Piper extraResources', () => {
  it('exclut le dossier cache/ des archives Piper (~25 Mo inutiles)', () => {
    const yaml = readFileSync(join(import.meta.dirname, 'electron-builder.yml'), 'utf8');
    expect(yaml).toMatch(/from: voice-assets\/piper/);
    expect(yaml).toContain('!cache/**');
  });
});
