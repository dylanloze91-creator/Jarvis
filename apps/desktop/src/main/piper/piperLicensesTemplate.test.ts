import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const templateDir = join(import.meta.dirname, '..', '..', '..', 'piper-licenses');

describe('modèles de licences Piper (installateur)', () => {
  it('contient GPL, README et fiches MODEL_CARD', () => {
    const names = readdirSync(templateDir);
    expect(names).toEqual(expect.arrayContaining(['GPL-3.0.txt', 'README.md', 'MODEL_CARD-siwis.md', 'MODEL_CARD-upmc.md']));
    for (const file of ['GPL-3.0.txt', 'README.md', 'MODEL_CARD-siwis.md', 'MODEL_CARD-upmc.md']) {
      expect(existsSync(join(templateDir, file))).toBe(true);
    }
  });
});
