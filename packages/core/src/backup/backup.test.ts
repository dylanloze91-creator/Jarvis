import { describe, expect, it } from 'vitest';
import {
  BACKUP_KEEP_DEFAULT,
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
      shouldRunAutomaticBackup({ now: day, lastAt: null, frequency: 'daily', idle: true, directoryReady: true }),
    ).toBe(true);
    expect(
      shouldRunAutomaticBackup({ now: day, lastAt: 1, frequency: 'daily', idle: false, directoryReady: true }),
    ).toBe(false);
    expect(
      shouldRunAutomaticBackup({ now: day, lastAt: day, frequency: 'daily', idle: true, directoryReady: true }),
    ).toBe(false);
    expect(
      shouldRunAutomaticBackup({ now: day * 2, lastAt: day, frequency: 'weekly', idle: true, directoryReady: true }),
    ).toBe(false);
  });

  it('relit un zip et refuse un chemin qui remonte', () => {
    const packed = zipStore([{ path: 'manifeste.json', data: new TextEncoder().encode('{"version":1}') }]);
    const files = unzipStore(packed);
    expect(new TextDecoder().decode(files[0]?.data)).toContain('version');
    expect(() => zipStore([{ path: '../secrets.txt', data: new Uint8Array([1]) }])).toThrow(/refusé/);
  });
});
