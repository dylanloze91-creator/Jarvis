/**
 * Zip → tar.gz, sans dépendance : alphacephei publie les modèles Vosk en
 * `.zip`, vosk-browser lit un `.tar.gz` (dossier de premier niveau retiré à
 * l'extraction). Zip classique seulement (ni zip64 ni chiffrement).
 */
import { createHash } from 'node:crypto';
import { gzipSync, inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Entrées d'une archive zip : `{ name, data, directory }`, dans l'ordre du répertoire central. */
export function readZipEntries(zip) {
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65_557); offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('Archive zip illisible : fin de répertoire introuvable.');
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(cursor) !== CENTRAL) throw new Error('Archive zip illisible : répertoire central abîmé.');
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new Error(`Zip64 non pris en charge : ${name}`);
    if (name.endsWith('/')) {
      entries.push({ name, data: Buffer.alloc(0), directory: true });
      continue;
    }
    if (zip.readUInt32LE(localOffset) !== LOCAL) throw new Error(`Entrée zip abîmée : ${name}`);
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`Compression zip ${method} non prise en charge : ${name}`);
    if (data.length !== size) throw new Error(`Taille inattendue pour ${name} : ${data.length} au lieu de ${size}`);
    entries.push({ name, data, directory: false });
  }
  return entries;
}

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function header(name, size, directory, mtime) {
  const block = Buffer.alloc(512);
  let prefix = '';
  let short = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', name.length - 2);
    prefix = name.slice(0, cut);
    short = name.slice(cut + 1);
    if (Buffer.byteLength(short) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Chemin trop long pour tar : ${name}`);
  }
  block.write(short, 0, 100, 'utf8');
  block.write(octal(directory ? 0o755 : 0o644, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(mtime, 12), 136, 'ascii');
  block.fill(0x20, 148, 156);
  block.write(directory ? '5' : '0', 156, 'ascii');
  block.write('ustar\u000000', 257, 'binary');
  block.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

/** Archive tar (ustar) compressée gzip. `mtime` fixe : même sortie à chaque préparation. */
export function tarGz(entries, mtime = 1_643_000_000) {
  const parts = [];
  for (const entry of entries) {
    parts.push(header(entry.name, entry.directory ? 0 : entry.data.length, entry.directory, mtime));
    if (!entry.directory) {
      parts.push(entry.data);
      const padding = (512 - (entry.data.length % 512)) % 512;
      if (padding) parts.push(Buffer.alloc(padding));
    }
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 6 });
}

export function zipToTarGz(zip) {
  return tarGz(readZipEntries(zip));
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
