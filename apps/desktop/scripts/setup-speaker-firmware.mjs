#!/usr/bin/env node
/**
 * Compile le programme de l'enceinte (PlatformIO) et le copie à côté de Jarvis.
 * Ce n'est pas `setup:voice` : Jarvis démarre sans PlatformIO.
 *
 *   npm run setup:speaker-firmware
 *
 * Les fichiers `.bin` ne sont pas versionnés. Sans `pio`, le script s'arrête
 * avec un message clair et ne fabrique rien.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const repo = resolve(desktop, '../..');
const firmwareDir = join(repo, 'firmware', 'jarvis-speaker');
const outDir = join(desktop, 'speaker-firmware');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parsePartitions(csv) {
  const rows = [];
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = line.split(',').map((cell) => cell.trim());
    if (cells.length < 5) continue;
    rows.push({
      name: cells[0],
      type: cells[1],
      subtype: cells[2],
      offset: Number.parseInt(cells[3], 16),
      size: Number.parseInt(cells[4], 16),
    });
  }
  return rows;
}

function offsetsOf(rows) {
  const app = rows.find((row) => row.type === 'app' && (row.subtype === 'factory' || row.subtype === 'ota_0'));
  const model = rows.find((row) => row.name === 'model');
  if (!app || !model || !Number.isFinite(app.offset) || !Number.isFinite(model.offset)) {
    fail('Table des partitions illisible : il faut une application et une partition « model ».');
  }
  return {
    'bootloader.bin': 0x0,
    'partitions.bin': 0x8000,
    'firmware.bin': app.offset,
    'srmodels.bin': model.offset,
  };
}

function versionOf(header) {
  const match = header.match(/JARVIS_FW_VERSION\s+"([^"]+)"/);
  return match ? match[1] : '0';
}

function commitOf() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  } catch {
    return 'inconnu';
  }
}

const pio = process.env.PIO || 'pio';
let help = '';
try {
  help = execFileSync(pio, ['--version'], { encoding: 'utf8' });
} catch {
  fail("PlatformIO (pio) est introuvable. Le programme de l'enceinte n'a pas été fabriqué. Jarvis, lui, démarre quand même.");
}
if (!help.toLowerCase().includes('platformio')) {
  fail(`« ${pio} » ne ressemble pas à PlatformIO.`);
}

execFileSync(pio, ['run', '-d', firmwareDir], { stdio: 'inherit' });

const buildDir = join(firmwareDir, '.pio', 'build', 'esp32-s3-devkitc-1');
const sources = {
  'bootloader.bin': join(buildDir, 'bootloader.bin'),
  'partitions.bin': join(buildDir, 'partitions.bin'),
  'firmware.bin': join(buildDir, 'firmware.bin'),
  'srmodels.bin': join(buildDir, 'srmodels', 'srmodels.bin'),
};
for (const [name, path] of Object.entries(sources)) {
  if (!existsSync(path)) fail(`Fichier manquant après la compilation : ${name}`);
}

const rows = parsePartitions(readFileSync(join(firmwareDir, 'partitions.csv'), 'utf8'));
const offsets = offsetsOf(rows);
const header = readFileSync(join(firmwareDir, 'include', 'config.h'), 'utf8');
mkdirSync(outDir, { recursive: true });

const files = [];
for (const name of Object.keys(sources)) {
  const bytes = readFileSync(sources[name]);
  copyFileSync(sources[name], join(outDir, name));
  files.push({
    name,
    offset: offsets[name],
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

const manifest = {
  version: versionOf(header),
  chip: 'ESP32-S3',
  flashSize: '8MB',
  commit: commitOf(),
  files,
};
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Programme enceinte ${manifest.version} copié dans speaker-firmware/ (${files.length} fichiers).`);
