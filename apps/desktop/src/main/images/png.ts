/**
 * Version noir et blanc d'un PNG, sans dépendance : décodage des chunks, dégonflage
 * (zlib de Node), défiltrage des lignes, seuil de luminance, ré-encodage (filtre 0).
 * Prévu pour les PNG 8 bits RGB / RGBA / gris produits par Forge ; les autres formats
 * (palette, 16 bits, entrelacé) sont refusés proprement.
 */

import { Buffer } from 'node:buffer';
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export interface DecodedPng {
  width: number;
  height: number;
  /** Octets par pixel (1 gris, 2 gris+alpha, 3 RGB, 4 RGBA). */
  channels: number;
  /** Pixels défiltrés, ligne par ligne, sans octet de filtre. */
  pixels: Buffer;
}

export class PngError extends Error {}

export function decodePng(file: Buffer): DecodedPng {
  if (file.length < 8 || !file.subarray(0, 8).equals(SIGNATURE)) throw new PngError('Ce fichier n’est pas un PNG.');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('latin1', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!width || !height) throw new PngError('PNG sans en-tête IHDR.');
  if (bitDepth !== 8) throw new PngError(`PNG ${bitDepth} bits non pris en charge (8 bits attendu).`);
  if (interlace !== 0) throw new PngError('PNG entrelacé non pris en charge.');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new PngError(`Type de couleur PNG ${colorType} non pris en charge (palette ?).`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new PngError('Données PNG incomplètes.');
  const pixels = Buffer.alloc(stride * height);
  const previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels]! : 0;
      const b = previous[x]!;
      const c = x >= channels ? previous[x - channels]! : 0;
      let value = line[x]!;
      switch (filter) {
        case 0:
          break;
        case 1:
          value += a;
          break;
        case 2:
          value += b;
          break;
        case 3:
          value += (a + b) >> 1;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new PngError(`Filtre PNG inconnu : ${filter}.`);
      }
      out[x] = value & 0xff;
    }
    out.copy(previous);
  }
  return { width, height, channels, pixels };
}

/** Encode une image en niveaux de gris 8 bits (type de couleur 0), filtre 0 sur chaque ligne. */
export function encodeGrayPng(width: number, height: number, gray: Buffer): Buffer {
  if (gray.length !== width * height) throw new PngError('Taille des pixels gris incohérente.');
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    gray.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

export interface BlackAndWhiteOptions {
  /** 0 à 255 : au-dessus = blanc. 160 par défaut (un sticker a des aplats clairs). */
  threshold?: number;
}

/**
 * Noir et blanc pur (deux valeurs) pour la découpe vinyle : luminance Rec. 601,
 * un pixel transparent devient blanc. Lève `PngError` sur un PNG non pris en charge.
 */
export function toBlackAndWhitePng(file: Buffer, options: BlackAndWhiteOptions = {}): Buffer {
  const threshold = Math.min(255, Math.max(0, options.threshold ?? 160));
  const image = decodePng(file);
  const gray = Buffer.alloc(image.width * image.height);
  const { channels, pixels } = image;
  for (let i = 0, p = 0; i < gray.length; i += 1, p += channels) {
    let luminance: number;
    if (channels <= 2) luminance = pixels[p]!;
    else luminance = (pixels[p]! * 299 + pixels[p + 1]! * 587 + pixels[p + 2]! * 114) / 1000;
    const alpha = channels === 2 ? pixels[p + 1]! : channels === 4 ? pixels[p + 3]! : 255;
    // Fond transparent = blanc ; un pixel à moitié transparent tire vers le blanc.
    const composed = luminance * (alpha / 255) + 255 * (1 - alpha / 255);
    gray[i] = composed > threshold ? 255 : 0;
  }
  return encodeGrayPng(image.width, image.height, gray);
}

/** Encode un petit PNG RGB(A) 8 bits : sert aux tests et à des aperçus. */
export function encodeRgbaPng(width: number, height: number, rgba: Buffer, channels: 3 | 4 = 4): Buffer {
  const stride = width * channels;
  if (rgba.length !== stride * height) throw new PngError('Taille des pixels incohérente.');
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
