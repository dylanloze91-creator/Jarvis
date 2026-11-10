/** Dimensions d'une image d'après ses premiers octets (PNG, JPEG, WebP). `null` si inconnu. */
export function imageDimensions(file: Buffer): { width: number; height: number } | null {
  if (file.length >= 24 && file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
  }
  if (file.length >= 4 && file[0] === 0xff && file[1] === 0xd8) return jpegDimensions(file);
  if (file.length >= 30 && file.toString('latin1', 0, 4) === 'RIFF' && file.toString('latin1', 8, 12) === 'WEBP') return webpDimensions(file);
  return null;
}

function jpegDimensions(file: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < file.length) {
    if (file[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = file[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = file.readUInt16BE(offset + 2);
    // SOF0 à SOF15 (sauf DHT 0xc4, JPG 0xc8, DAC 0xcc) : hauteur puis largeur.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: file.readUInt16BE(offset + 5), width: file.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(file: Buffer): { width: number; height: number } | null {
  const chunk = file.toString('latin1', 12, 16);
  if (chunk === 'VP8X' && file.length >= 30) {
    return { width: 1 + file.readUIntLE(24, 3), height: 1 + file.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L' && file.length >= 25) {
    const bits = file.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ' && file.length >= 30) {
    return { width: file.readUInt16LE(26) & 0x3fff, height: file.readUInt16LE(28) & 0x3fff };
  }
  return null;
}
