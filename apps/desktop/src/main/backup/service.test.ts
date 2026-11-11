import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSettings } from '@jarvis/core';
import { afterEach, describe, expect, it } from 'vitest';
import { backupZipWrites, readZipEntry, resetBackupZipWrites, verifyZipEntries } from './archive.js';
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

  it('écrit le zip une seule fois', async () => {
    const { userData, dest } = await fresh();
    await writeFile(join(userData, 'settings.json'), '{}');
    resetBackupZipWrites();
    const service = new BackupService({
      userData: () => userData,
      getSettings: () => parseSettings({ backup: { directory: dest } }),
      version: () => '5.0.70',
      isIdle: () => true,
      now: () => new Date('2026-11-08T08:00:00.000Z'),
    });
    expect((await service.backupNow()).ok).toBe(true);
    expect(backupZipWrites).toBe(1);
  });

  it('keep=1 : restaurer l’unique sauvegarde ne l’efface pas', async () => {
    const { userData, dest } = await fresh();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(userData, 'conversations'), { recursive: true });
    await writeFile(join(userData, 'conversations', 'une.json'), 'version-1');
    await writeFile(join(userData, 'settings.json'), '{}');
    let now = new Date('2026-11-08T08:00:00.000Z');
    const service = new BackupService({
      userData: () => userData,
      getSettings: () => parseSettings({ backup: { directory: dest, keep: 1 } }),
      version: () => '5.0.70',
      isIdle: () => true,
      now: () => now,
    });
    const made = await service.backupNow();
    expect(made.ok, made.error).toBe(true);
    await writeFile(join(userData, 'conversations', 'une.json'), 'version-2');
    now = new Date('2026-11-08T09:00:00.000Z');
    const restored = await service.restore(made.file);
    expect(restored.ok, restored.error).toBe(true);
    expect(await readFile(join(userData, 'conversations', 'une.json'), 'utf8')).toBe('version-1');
    const names = await readdir(dest);
    expect(names).toContain(made.file);
  });

  it('un échec ne reporte pas l’échéance : nouvel essai au plus tôt une heure après', async () => {
    const { userData, dest } = await fresh();
    await writeFile(join(userData, 'settings.json'), '{}');
    let directory = dest;
    let now = new Date('2026-11-01T10:00:00.000Z');
    const service = new BackupService({
      userData: () => userData,
      getSettings: () => parseSettings({ backup: { directory, frequency: 'daily' } }),
      version: () => '5.0.70',
      isIdle: () => true,
      now: () => now,
    });
    expect((await service.backupNow()).ok).toBe(true);
    directory = join(dest, 'pas-un-dossier');
    await writeFile(directory, 'bloque');
    now = new Date('2026-11-03T10:00:00.000Z');
    const failed = await service.backupIfDue();
    expect(failed?.ok).toBe(false);
    now = new Date('2026-11-03T10:30:00.000Z');
    directory = dest;
    expect(await service.backupIfDue()).toBeNull();
    now = new Date('2026-11-03T12:00:00.000Z');
    const retry = await service.backupIfDue();
    expect(retry?.ok, retry?.error).toBe(true);
  });

  it('refuse une sauvegarde sans manifeste valide et n’écrit rien', async () => {
    const { userData, dest } = await fresh();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(userData, 'conversations'), { recursive: true });
    await writeFile(join(userData, 'conversations', 'une.json'), 'version-bonne');
    await writeFile(join(userData, 'settings.json'), '{}');
    const { zipStore } = await import('@jarvis/core');
    const bogus = zipStore([{ path: 'conversations/une.json', data: new TextEncoder().encode('version-mauvaise') }]);
    await writeFile(join(dest, 'jarvis-sauvegarde-20261108T080000Z.zip'), bogus);
    const service = new BackupService({
      userData: () => userData,
      getSettings: () => parseSettings({ backup: { directory: dest, keep: 4 } }),
      version: () => '5.0.70',
      isIdle: () => true,
    });
    const restored = await service.restore('jarvis-sauvegarde-20261108T080000Z.zip');
    expect(restored.ok).toBe(false);
    expect(await readFile(join(userData, 'conversations', 'une.json'), 'utf8')).toBe('version-bonne');
  });

  it('n’emporte ni node_modules, ni .git, ni lien, ni le dossier de destination, ni un .partiel', async () => {
    const { userData } = await fresh();
    const { mkdir, symlink } = await import('node:fs/promises');
    await mkdir(join(userData, 'developer', 'node_modules', 'paquet'), { recursive: true });
    await mkdir(join(userData, 'developer', '.git'), { recursive: true });
    await mkdir(join(userData, 'developer', 'src'), { recursive: true });
    await writeFile(join(userData, 'developer', 'node_modules', 'paquet', 'index.js'), 'secret');
    await writeFile(join(userData, 'developer', '.git', 'config'), 'secret');
    await writeFile(join(userData, 'developer', 'src', 'main.ts'), 'ok');
    await symlink(join(userData, 'developer', 'src', 'main.ts'), join(userData, 'developer', 'lien'));
    await writeFile(join(userData, 'settings.json'), '{}');
    const inside = join(userData, 'developer', 'sauvegardes');
    await mkdir(inside, { recursive: true });
    await writeFile(join(inside, 'brouillon.partiel'), 'partiel');
    const service = new BackupService({
      userData: () => userData,
      getSettings: () => parseSettings({ backup: { directory: inside } }),
      version: () => '5.0.70',
      isIdle: () => true,
      now: () => new Date('2026-11-08T08:00:00.000Z'),
    });
    const made = await service.backupNow();
    expect(made.ok, made.error).toBe(true);
    const { readZipEntry } = await import('./archive.js');
    const zip = join(inside, made.file);
    expect(await readZipEntry(zip, 'developer/src/main.ts')).not.toBeNull();
    expect(await readZipEntry(zip, 'developer/node_modules/paquet/index.js')).toBeNull();
    expect(await readZipEntry(zip, 'developer/.git/config')).toBeNull();
    expect(await readZipEntry(zip, 'developer/lien')).toBeNull();
    expect(await readZipEntry(zip, 'sauvegardes/brouillon.partiel')).toBeNull();
  });
});
