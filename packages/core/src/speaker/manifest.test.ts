import { describe, expect, it } from 'vitest';
import {
  checkFirmwareManifest,
  firmwareOffsets,
  parsePartitionTable,
  sameFirmware,
  type SpeakerFwManifest,
} from './manifest.js';

const CSV = `
# Enceinte Jarvis
nvs,        data, nvs,      0x9000,   0x6000,
phy_init,   data, phy,      0xf000,   0x1000,
factory,    app,  factory,  0x10000,  0x300000,
model,      data, spiffs,   0x310000, 0x200000,
`;

const sha = (fill: string): string => fill.repeat(64).slice(0, 64);

function manifest(): SpeakerFwManifest {
  return {
    version: '5.0.75',
    chip: 'ESP32-S3',
    flashSize: '8MB',
    commit: 'synthetique-test',
    files: [
      { name: 'bootloader.bin', offset: 0, size: 4, sha256: sha('a') },
      { name: 'partitions.bin', offset: 0x8000, size: 4, sha256: sha('b') },
      { name: 'firmware.bin', offset: 0x10000, size: 4, sha256: sha('c') },
      { name: 'srmodels.bin', offset: 0x310000, size: 4, sha256: sha('d') },
    ],
  };
}

const files = {
  'bootloader.bin': new Uint8Array([1, 2, 3, 4]),
  'partitions.bin': new Uint8Array([1, 2, 3, 4]),
  'firmware.bin': new Uint8Array([1, 2, 3, 4]),
  'srmodels.bin': new Uint8Array([1, 2, 3, 4]),
};

const digests = {
  'bootloader.bin': sha('a'),
  'partitions.bin': sha('b'),
  'firmware.bin': sha('c'),
  'srmodels.bin': sha('d'),
};

describe('manifeste du programme enceinte', () => {
  it('lit les adresses dans la table, sans les réécrire à la main', () => {
    const offsets = firmwareOffsets(parsePartitionTable(CSV));
    expect(offsets).toEqual({
      'bootloader.bin': 0,
      'partitions.bin': 0x8000,
      'firmware.bin': 0x10000,
      'srmodels.bin': 0x310000,
    });
  });

  it('accepte un manifeste cohérent marqué synthetique-test', () => {
    expect(checkFirmwareManifest(manifest(), files, digests)).toEqual({ ok: true });
  });

  it('refuse une empreinte fausse, un trou, un dépassement et un fichier absent', () => {
    const badDigest = { ...digests, 'firmware.bin': sha('e') };
    expect(checkFirmwareManifest(manifest(), files, badDigest).ok).toBe(false);
    const overlap = manifest();
    overlap.files[2] = { ...overlap.files[2]!, offset: 0 };
    expect(checkFirmwareManifest(overlap, files, digests)).toMatchObject({ ok: false, issue: 'chevauchement' });
    const huge = manifest();
    huge.files[3] = { ...huge.files[3]!, offset: 0x7ffff0, size: 32 };
    const hugeFiles = { ...files, 'srmodels.bin': new Uint8Array(32) };
    expect(checkFirmwareManifest(huge, hugeFiles, digests)).toMatchObject({ ok: false, issue: 'hors-flash' });
    const missing = { ...files };
    delete missing['srmodels.bin'];
    expect(checkFirmwareManifest(manifest(), missing, digests)).toMatchObject({ ok: false, issue: 'fichier-manquant' });
  });

  it('saute l’écriture quand la carte a déjà cette version', () => {
    expect(sameFirmware('5.0.75', '5.0.75')).toBe(true);
    expect(sameFirmware('5.0.64', '5.0.75')).toBe(false);
    expect(sameFirmware(null, '5.0.75')).toBe(false);
  });
});
