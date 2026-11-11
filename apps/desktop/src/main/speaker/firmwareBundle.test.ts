import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSpeakerFirmware } from './firmwareBundle.js';

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('programme livré', () => {
  it('refuse un dossier vide et accepte quatre fichiers dont l’empreinte colle', () => {
    const empty = mkdtempSync(join(tmpdir(), 'jarvis-fw-'));
    expect(loadSpeakerFirmware(empty)).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-fw-'));
    mkdirSync(dir, { recursive: true });
    const bins = {
      'bootloader.bin': new Uint8Array([1, 2, 3, 4]),
      'partitions.bin': new Uint8Array([5, 6, 7, 8]),
      'firmware.bin': new Uint8Array([9, 9, 9, 9]),
      'srmodels.bin': new Uint8Array([3, 3, 3, 3]),
    } as const;
    const files = (Object.keys(bins) as Array<keyof typeof bins>).map((name, index) => {
      writeFileSync(join(dir, name), bins[name]);
      const offsets = [0, 0x8000, 0x10000, 0x310000];
      return { name, offset: offsets[index], size: 4, sha256: sha(bins[name]) };
    });
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ version: '5.0.75', chip: 'ESP32-S3', flashSize: '8MB', commit: 'synthetique-test', files }),
    );
    const bundle = loadSpeakerFirmware(dir);
    expect(bundle?.version).toBe('5.0.75');
    expect(bundle?.files).toHaveLength(4);
    expect(bundle?.files[2]?.md5).toMatch(/^[0-9a-f]{32}$/);
  });
});
