import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSettings } from '@jarvis/core';
import { afterEach, describe, expect, it } from 'vitest';
import { readZipEntry, verifyZipEntries } from './archive.js';
import { BackupService } from './service.js';

const dirs: string[] = [];

async function fresh(): Promise<{ userData: string; dest: string }> {
  const userData = await mkdtemp(join(tmpdir(), 'jarvis-donnees-'));
  const dest = await mkdtemp(join(tmpdir(), 'jarvis-sauve-'));
  dirs.push(userData, dest);
  return { userData, dest };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('sauvegarde sur disque', () => {
  it('copie le contenu, aucun secret, et ne supprime que ses zip', async () => {
    const { userData, dest } = await fresh();
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ provider: 'openai', apiKey: 'sk-exemple-secret-123456' }));
    await writeFile(join(userData, 'spotify-token.json'), '{"access":"jeton-spotify-secret"}');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(userData, 'conversations'), { recursive: true });
    await writeFile(join(userData, 'conversations', 'une.json'), '{"title":"essai"}');
    await writeFile(join(userData, 'personalization.json'), '{"user":{"prenom":"Camarade"}}');
    await writeFile(join(dest, 'notes.txt'), 'à garder');
    await writeFile(join(dest, 'photo.zip'), 'pas une sauvegarde');
    let now = new Date('2026-11-01T10:00:00.000Z');
    const service = new BackupService({
      userData: () => userData,
      getSettings: () => parseSettings({ provider: 'openai', apiKey: 'sk-exemple-secret-123456', backup: { directory: dest, keep: 4 } }),
      version: () => '5.0.70',
      isIdle: () => true,
      now: () => now,
    });
    for (let index = 0; index < 5; index += 1) {
      now = new Date(Date.UTC(2026, 10, index + 1, 10, 0, 0));
      const result = await service.backupNow();
      expect(result.ok, result.error).toBe(true);
    }
    const names = await readdir(dest);
    expect(names).toContain('notes.txt');
    expect(names).toContain('photo.zip');
    const zips = names.filter((name) => name.startsWith('jarvis-sauvegarde-') && name.endsWith('.zip'));
    expect(zips).toHaveLength(4);
    expect(zips.some((name) => name.includes('20261101'))).toBe(false);
    const newest = zips.sort().at(-1);
    expect(newest).toBeTruthy();
    if (!newest) return;
    const settings = new TextDecoder().decode((await readZipEntry(join(dest, newest), 'settings.json')) ?? new Uint8Array());
    expect(settings).not.toContain('sk-exemple-secret');
    expect(settings).toContain('"apiKey": ""');
    const spotify = await readZipEntry(join(dest, newest), 'spotify-token.json');
    expect(spotify).toBeNull();
    const manifestRaw = new TextDecoder().decode((await readZipEntry(join(dest, newest), 'manifeste.json')) ?? new Uint8Array());
    expect(manifestRaw).toContain('reconnecte');
    const flipped = Buffer.from(await readFile(join(dest, newest)));
    const flipAt = Math.min(80, flipped.length - 1);
    flipped[flipAt] = (flipped[flipAt] ?? 0) ^ 0xff;
    const { writeFile: write } = await import('node:fs/promises');
    await write(join(dest, newest), flipped);
    const manifest = JSON.parse(manifestRaw) as { entries: { path: string; bytes: number; sha256: string }[] };
    const problems = await verifyZipEntries(join(dest, newest), manifest.entries);
    expect(problems.some((problem) => problem.includes('empreinte fausse'))).toBe(true);
  });

  it('restaure après une copie de sécurité', async () => {
    const { userData, dest } = await fresh();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(userData, 'conversations'), { recursive: true });
    await writeFile(join(userData, 'conversations', 'une.json'), 'version-1');
    await writeFile(join(userData, 'settings.json'), '{}');
    let now = new Date('2026-11-08T08:00:00.000Z');
    let relaunched = false;
    const service = new BackupService({
      userData: () => userData,
      getSettings: () => parseSettings({ backup: { directory: dest } }),
      version: () => '5.0.70',
      isIdle: () => true,
      now: () => now,
      relaunch: () => {
        relaunched = true;
      },
    });
    const made = await service.backupNow();
    expect(made.ok).toBe(true);
    await writeFile(join(userData, 'conversations', 'une.json'), 'version-2');
    now = new Date('2026-11-08T09:00:00.000Z');
    const restored = await service.restore(made.file);
    expect(restored.ok, restored.error).toBe(true);
    expect(await readFile(join(userData, 'conversations', 'une.json'), 'utf8')).toBe('version-1');
    expect(relaunched).toBe(true);
    const names = await readdir(dest);
    expect(names.filter((name) => name.endsWith('.zip')).length).toBeGreaterThan(1);
  });
});
