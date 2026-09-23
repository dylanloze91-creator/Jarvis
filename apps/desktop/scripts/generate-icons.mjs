import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

/**
 * Génère les icônes de l'application sans dépendance externe : un anneau
 * lumineux sur fond sombre, décliné en icône d'application et en icône de zone
 * de notification. electron-builder dérive le .ico Windows de `icon.png`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const resources = join(here, '..', 'resources');

const ACCENT = [86, 200, 240];

function renderIcon(size, { opaque }) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const outer = size * 0.42;
  const inner = size * 0.3;
  const core = size * 0.14;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const offset = (y * size + x) * 4;

      let [r, g, b] = [0, 0, 0];
      let alpha = 0;

      if (opaque && distance <= outer + 1) {
        [r, g, b] = [16, 20, 30];
        alpha = 255;
      }

      const ring = 1 - smoothBand(distance, inner, outer, size * 0.035);
      if (ring > 0) {
        [r, g, b] = ACCENT;
        alpha = Math.max(alpha, Math.round(255 * ring));
      }

      const dot = 1 - smoothstep(core - size * 0.03, core, distance);
      if (dot > 0) {
        [r, g, b] = [235, 250, 255];
        alpha = Math.max(alpha, Math.round(255 * dot));
      }

      pixels.writeUInt8(r, offset);
      pixels.writeUInt8(g, offset + 1);
      pixels.writeUInt8(b, offset + 2);
      pixels.writeUInt8(alpha, offset + 3);
    }
  }

  return encodePng(size, size, pixels);
}

/** 0 sur l'anneau [from, to], 1 en dehors, avec un bord adouci. */
function smoothBand(distance, from, to, feather) {
  if (distance >= from && distance <= to) return 0;
  const gap = distance < from ? from - distance : distance - to;
  return smoothstep(0, feather, gap);
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw.writeUInt8(0, y * (width * 4 + 1));
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([header, data, crc]);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ 0xffffffff;
}

mkdirSync(resources, { recursive: true });
writeFileSync(join(resources, 'icon.png'), renderIcon(256, { opaque: true }));
writeFileSync(join(resources, 'tray.png'), renderIcon(32, { opaque: false }));
console.log('Icônes générées dans apps/desktop/resources');
