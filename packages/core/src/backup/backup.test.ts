import { describe, expect, it } from 'vitest';
import {
  BACKUP_KEEP_DEFAULT,
  backupKeepCount,
  backupTooBigMessage,
  backupZipName,
  backupsToDelete,
  buildManifest,
  shouldRunAutomaticBackup,
  verifyManifest,
} from './plan.js';
import { unzipStore, zipStore } from './zip.js';

describe('sauvegarde', () => {
  it('garde 4 archives par défaut et ne touche qu’aux jarvis-sauvegarde-*.zip', () => {
    const names = [
      'notes.txt',
      'jarvis-sauvegarde-20261101T100000Z.zip',
      'jarvis-sauvegarde-20261102T100000Z.zip',
      'jarvis-sauvegarde-20261103T100000Z.zip',
      'jarvis-sauvegarde-20261104T100000Z.zip',
      'jarvis-sauvegarde-20261105T100000Z.zip',
      'photo.zip',
      'jarvis-sauvegarde-rate.txt',
    ];
    expect(backupsToDelete(names, BACKUP_KEEP_DEFAULT)).toEqual(['jarvis-sauvegarde-20261101T100000Z.zip']);
    expect(backupsToDelete(names, 5)).toEqual([]);
  });

  it('nomme le zip sans deux-points et le manifeste porte les empreintes', () => {
    expect(backupZipName(new Date('2026-11-08T10:47:00.000Z'))).toBe('jarvis-sauvegarde-20261108T104700Z.zip');
    const manifest = buildManifest(
      [{ path: 'conversations/une.json', bytes: 4, sha256: 'abc' }],
      '5.0.70',
      new Date('2026-11-08T10:47:00.000Z'),
    );
    expect(manifest.jarvis).toBe('5.0.70');
    expect(manifest.note).toMatch(/reconnecte/);
    expect(verifyManifest(manifest, manifest.entries)).toEqual([]);
    expect(verifyManifest(manifest, [{ path: 'conversations/une.json', bytes: 4, sha256: 'faux' }])).toEqual([
      'conversations/une.json : empreinte fausse',
    ]);
  });

  it('n’écrit une sauvegarde automatique que si le PC est inactif et la période écoulée', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(
      shouldRunAutomaticBackup({ now: day, lastSuccessAt: null, frequency: 'daily', idle: true, directoryReady: true }),
    ).toBe(true);
    expect(
      shouldRunAutomaticBackup({ now: day, lastSuccessAt: 1, frequency: 'daily', idle: false, directoryReady: true }),
    ).toBe(false);
    expect(
      shouldRunAutomaticBackup({ now: day, lastSuccessAt: day, frequency: 'daily', idle: true, directoryReady: true }),
    ).toBe(false);
    expect(
      shouldRunAutomaticBackup({ now: day * 2, lastSuccessAt: day, frequency: 'weekly', idle: true, directoryReady: true }),
    ).toBe(false);
  });

  it('un échec attend une heure et ne repousse pas la période réussie', () => {
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    expect(
      shouldRunAutomaticBackup({
        now: day * 3,
        lastSuccessAt: day,
        failedAt: day * 3 - 2 * hour,
        frequency: 'daily',
        idle: true,
        directoryReady: true,
      }),
    ).toBe(true);
    expect(
      shouldRunAutomaticBackup({
        now: day * 3,
        lastSuccessAt: day,
        failedAt: day * 3 - 30 * 60 * 1000,
        frequency: 'daily',
        idle: true,
        directoryReady: true,
      }),
    ).toBe(false);
  });

  it('borne le nombre gardé entre 1 et 48', () => {
    expect(backupKeepCount(99)).toBe(48);
    expect(backupKeepCount(0)).toBe(BACKUP_KEEP_DEFAULT);
    expect(backupKeepCount(1)).toBe(1);
  });

  it('refuse un fichier de plus de 4 Go', () => {
    expect(backupTooBigMessage(0x1_0000_0000, 'gros.bin')).toMatch(/trop gros/);
    expect(backupTooBigMessage(10, 'petit.txt')).toBeNull();
  });

  it('relit un zip et refuse un chemin qui remonte', () => {
    const packed = zipStore([{ path: 'manifeste.json', data: new TextEncoder().encode('{"version":1}') }]);
    const files = unzipStore(packed);
    expect(new TextDecoder().decode(files[0]?.data)).toContain('version');
    expect(() => zipStore([{ path: '../secrets.txt', data: new Uint8Array([1]) }])).toThrow(/refusé/);
  });
});
