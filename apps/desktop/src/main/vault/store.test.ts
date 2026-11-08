import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SECRET_MARKER, maskSecrets, parseSettings } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import type { SecretCipher } from '../google/tokenStore.js';
import { KeyVault } from './store.js';

function cipher(available = true): SecretCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').toString('base64'), 'utf8'),
    decryptString: (encrypted) => Buffer.from(Buffer.from(encrypted).toString('utf8'), 'base64').toString('utf8'),
  };
}

describe('coffre', () => {
  it('déplace une clé en clair et ne la laisse ni dans settings ni en clair sur le disque', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-coffre-'));
    const vault = new KeyVault(() => dir, cipher());
    const settings = parseSettings({ provider: 'openai', apiKey: 'sk-clair-12345678' });
    const migrated = await vault.migrate(settings);
    expect(migrated.changed).toBe(true);
    expect(JSON.stringify(migrated.disk)).not.toContain('sk-clair');
    expect(migrated.memory.apiKey).toBe('sk-clair-12345678');
    const raw = await readFile(vault.filePath());
    expect(raw.includes(Buffer.from('sk-clair-12345678'))).toBe(false);
    expect(raw.toString('utf8')).not.toContain('sk-clair');
    const memory = await vault.apply(parseSettings({ provider: 'openai' }));
    expect(memory.apiKey).toBe('sk-clair-12345678');
    const shown = maskSecrets(memory, { apiKey: memory.apiKey });
    expect(shown.apiKey).toBe(SECRET_MARKER);
    expect(JSON.stringify(shown)).not.toContain('sk-clair');
  });

  it('sans chiffrement, les réglages restent comme avant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-coffre-off-'));
    const vault = new KeyVault(() => dir, cipher(false));
    const settings = parseSettings({ apiKey: 'sk-clair-12345678', provider: 'openai' });
    const migrated = await vault.migrate(settings);
    expect(migrated.changed).toBe(false);
    expect(migrated.disk.apiKey).toBe('sk-clair-12345678');
    expect(migrated.memory.apiKey).toBe('sk-clair-12345678');
    await expect(readFile(vault.filePath())).rejects.toThrow();
  });
});
