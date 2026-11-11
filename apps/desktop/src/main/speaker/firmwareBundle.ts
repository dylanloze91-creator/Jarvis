/**
 * Lit le programme livré (hors git). S'il manque, l'installation le dit et n'écrit rien.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkFirmwareManifest, type SpeakerFwFileName, type SpeakerFwManifest } from '@jarvis/core';

export interface FirmwareImage {
  name: SpeakerFwFileName;
  address: number;
  md5: string;
  data: Uint8Array;
}

export interface FirmwareBundle {
  version: string;
  files: FirmwareImage[];
}

const NAMES: SpeakerFwFileName[] = ['bootloader.bin', 'partitions.bin', 'firmware.bin', 'srmodels.bin'];

export function loadSpeakerFirmware(dir: string): FirmwareBundle | null {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  let manifest: SpeakerFwManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SpeakerFwManifest;
  } catch {
    return null;
  }
  const files: Partial<Record<SpeakerFwFileName, Uint8Array>> = {};
  const digests: Partial<Record<SpeakerFwFileName, string>> = {};
  const images: FirmwareImage[] = [];
  for (const name of NAMES) {
    const path = join(dir, name);
    if (!existsSync(path)) return null;
    const data = new Uint8Array(readFileSync(path));
    const entry = manifest.files.find((file) => file.name === name);
    if (!entry) return null;
    files[name] = data;
    digests[name] = createHash('sha256').update(data).digest('hex');
    images.push({
      name,
      address: entry.offset,
      md5: createHash('md5').update(data).digest('hex'),
      data,
    });
  }
  const check = checkFirmwareManifest(manifest, files, digests);
  if (!check.ok) return null;
  return { version: manifest.version, files: images };
}
