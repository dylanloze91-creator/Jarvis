import { safeZipPath } from './plan.js';

export interface ZipInput {
  path: string;
  data: Uint8Array;
}

interface StoredEntry {
  path: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  CRC_TABLE[index] = crc;
}

export function crc32Update(crc: number, data: Uint8Array): number {
  let next = crc;
  for (const byte of data) next = CRC_TABLE[(next ^ byte) & 0xff]! ^ (next >>> 8);
  return next >>> 0;
}

export function crc32Finish(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32(data: Uint8Array): number {
  return crc32Finish(crc32Update(0xffffffff, data));
}

export function zipLocalHeader(path: string, crc: number, size: number, at = new Date()): Uint8Array {
  const safe = safeZipPath(path);
  if (!safe) throw new Error(`Chemin de sauvegarde refusé : ${path}`);
  const name = new TextEncoder().encode(safe);
  const dos = dosTime(at);
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  u32(view, 0, 0x04034b50);
  u16(view, 4, 20);
  u16(view, 6, 0);
  u16(view, 8, 0);
  u16(view, 10, dos.time);
  u16(view, 12, dos.date);
  u32(view, 14, crc);
  u32(view, 18, size);
  u32(view, 22, size);
  u16(view, 26, name.length);
  u16(view, 28, 0);
  header.set(name, 30);
  return header;
}

function dosTime(at: Date): { time: number; date: number } {
  const time = (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2);
  const date = ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate();
  return { time, date };
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Zip sans compression (méthode 0). Les gros fichiers passent par `ZipStoreWriter`. */
export function zipStore(entries: readonly ZipInput[], at = new Date()): Uint8Array {
  const writer = new ZipStoreWriter(at);
  for (const entry of entries) writer.add(entry.path, entry.data);
  return writer.finish();
}

export class ZipStoreWriter {
  private readonly parts: Uint8Array[] = [];
  private readonly stored: StoredEntry[] = [];
  private offset = 0;
  private readonly time: number;
  private readonly date: number;

  constructor(at = new Date()) {
    const dos = dosTime(at);
    this.time = dos.time;
    this.date = dos.date;
  }

  add(path: string, data: Uint8Array): void {
    const safe = safeZipPath(path);
    if (!safe) throw new Error(`Chemin de sauvegarde refusé : ${path}`);
    const name = new TextEncoder().encode(safe);
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    u32(view, 0, 0x04034b50);
    u16(view, 4, 20);
    u16(view, 6, 0);
    u16(view, 8, 0);
    u16(view, 10, this.time);
    u16(view, 12, this.date);
    u32(view, 14, crc);
    u32(view, 18, data.length);
    u32(view, 22, data.length);
    u16(view, 26, name.length);
    u16(view, 28, 0);
    header.set(name, 30);
    this.stored.push({ path: safe, data, crc, offset: this.offset });
    this.push(header);
    this.push(data);
  }

  finish(): Uint8Array {
    const centralStart = this.offset;
    for (const entry of this.stored) {
      const name = new TextEncoder().encode(entry.path);
      const header = new Uint8Array(46 + name.length);
      const view = new DataView(header.buffer);
      u32(view, 0, 0x02014b50);
      u16(view, 4, 20);
      u16(view, 6, 20);
      u16(view, 8, 0);
      u16(view, 10, 0);
      u16(view, 12, this.time);
      u16(view, 14, this.date);
      u32(view, 16, entry.crc);
      u32(view, 20, entry.data.length);
      u32(view, 24, entry.data.length);
      u16(view, 28, name.length);
      u16(view, 30, 0);
      u16(view, 32, 0);
      u16(view, 34, 0);
      u16(view, 36, 0);
      u32(view, 38, 0);
      u32(view, 42, entry.offset);
      header.set(name, 46);
      this.push(header);
    }
    const centralSize = this.offset - centralStart;
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    u32(view, 0, 0x06054b50);
    u16(view, 4, 0);
    u16(view, 6, 0);
    u16(view, 8, this.stored.length);
    u16(view, 10, this.stored.length);
    u32(view, 12, centralSize);
    u32(view, 16, centralStart);
    u16(view, 20, 0);
    this.push(end);
    return concat(this.parts);
  }

  private push(chunk: Uint8Array): void {
    this.parts.push(chunk);
    this.offset += chunk.length;
  }
}

export interface ZipCentralEntry {
  path: string;
  crc: number;
  size: number;
  offset: number;
}

/** Répertoire central et fin de zip, une fois les fichiers déjà écrits. */
export function zipCentralDirectory(entries: readonly ZipCentralEntry[], centralStart: number, at = new Date()): Uint8Array {
  const dos = dosTime(at);
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const safe = safeZipPath(entry.path);
    if (!safe) throw new Error(`Chemin de sauvegarde refusé : ${entry.path}`);
    const name = new TextEncoder().encode(safe);
    const header = new Uint8Array(46 + name.length);
    const view = new DataView(header.buffer);
    u32(view, 0, 0x02014b50);
    u16(view, 4, 20);
    u16(view, 6, 20);
    u16(view, 8, 0);
    u16(view, 10, 0);
    u16(view, 12, dos.time);
    u16(view, 14, dos.date);
    u32(view, 16, entry.crc);
    u32(view, 20, entry.size);
    u32(view, 24, entry.size);
    u16(view, 28, name.length);
    u16(view, 30, 0);
    u16(view, 32, 0);
    u16(view, 34, 0);
    u16(view, 36, 0);
    u32(view, 38, 0);
    u32(view, 42, entry.offset);
    header.set(name, 46);
    parts.push(header);
  }
  const centralSize = parts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  u32(view, 0, 0x06054b50);
  u16(view, 4, 0);
  u16(view, 6, 0);
  u16(view, 8, entries.length);
  u16(view, 10, entries.length);
  u32(view, 12, centralSize);
  u32(view, 16, centralStart);
  u16(view, 20, 0);
  parts.push(end);
  return concat(parts);
}

export function unzipStore(bytes: Uint8Array): ZipInput[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipInput[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const path = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const data = bytes.subarray(dataStart, dataStart + size);
    if (method !== 0) throw new Error(`Zip compressé refusé : ${path}`);
    if (crc32(data) !== crc) throw new Error(`Empreinte fausse : ${path}`);
    const safe = safeZipPath(path);
    if (!safe) throw new Error(`Chemin refusé : ${path}`);
    entries.push({ path: safe, data });
    offset = dataStart + size;
  }
  return entries;
}
