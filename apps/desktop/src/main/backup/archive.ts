import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  crc32,
  crc32Finish,
  crc32Update,
  safeZipPath,
  zipCentralDirectory,
  zipLocalHeader,
  type BackupEntry,
  type ZipCentralEntry,
} from '@jarvis/core';

export interface ArchivePiece {
  zipPath: string;
  data?: Uint8Array;
  source?: string;
}

interface Measured {
  zipPath: string;
  data?: Uint8Array;
  source?: string;
  bytes: number;
  sha256: string;
  crc: number;
}

async function measure(piece: ArchivePiece): Promise<Measured> {
  const zipPath = safeZipPath(piece.zipPath);
  if (!zipPath) throw new Error(`Chemin refusé : ${piece.zipPath}`);
  if (piece.data) {
    return {
      zipPath,
      data: piece.data,
      bytes: piece.data.byteLength,
      sha256: createHash('sha256').update(piece.data).digest('hex'),
      crc: crc32(piece.data),
    };
  }
  if (!piece.source) throw new Error(`Pièce vide : ${piece.zipPath}`);
  const hash = createHash('sha256');
  let crc = 0xffffffff;
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(piece.source!);
    stream.on('data', (chunk: string | Buffer) => {
      const block = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      const view = new Uint8Array(block.buffer, block.byteOffset, block.byteLength);
      hash.update(view);
      crc = crc32Update(crc, view);
      bytes += view.byteLength;
    });
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return { zipPath, source: piece.source, bytes, sha256: hash.digest('hex'), crc: crc32Finish(crc) };
}

function writeChunk(stream: ReturnType<typeof createWriteStream>, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(Buffer.from(chunk), (error) => (error ? reject(error) : resolve()));
  });
}

/** Écrit un zip méthode 0, puis le relit pour comparer les empreintes. */
export async function writeVerifiedZip(
  partialPath: string,
  pieces: readonly ArchivePiece[],
  at = new Date(),
): Promise<{ entries: BackupEntry[] }> {
  const measured = [];
  for (const piece of pieces) measured.push(await measure(piece));
  const stream = createWriteStream(partialPath, { flags: 'w', mode: 0o600 });
  let offset = 0;
  const central: ZipCentralEntry[] = [];
  try {
    for (const piece of measured) {
      const header = zipLocalHeader(piece.zipPath, piece.crc, piece.bytes, at);
      await writeChunk(stream, header);
      const start = offset;
      offset += header.byteLength;
      if (piece.data) {
        await writeChunk(stream, piece.data);
        offset += piece.data.byteLength;
      } else if (piece.source) {
        const file = createReadStream(piece.source);
        await pipeline(file, stream, { end: false });
        offset += piece.bytes;
      }
      central.push({ path: piece.zipPath, crc: piece.crc, size: piece.bytes, offset: start });
    }
    const directory = zipCentralDirectory(central, offset, at);
    await writeChunk(stream, directory);
    await new Promise<void>((resolve, reject) => stream.end((error: NodeJS.ErrnoException | null | undefined) => (error ? reject(error) : resolve())));
  } catch (error) {
    stream.destroy();
    await rm(partialPath, { force: true });
    throw error;
  }
  return { entries: measured.map(({ zipPath, bytes, sha256 }) => ({ path: zipPath, bytes, sha256 })) };
}

export async function verifyZipEntries(zipPath: string, entries: readonly BackupEntry[]): Promise<string[]> {
  const found = new Map<string, BackupEntry>();
  const file = await open(zipPath, 'r');
  try {
    for (;;) {
      const header = Buffer.alloc(30);
      const read = await file.read(header, 0, 30, null);
      if (read.bytesRead < 30) break;
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const signature = view.getUint32(0, true);
      if (signature !== 0x04034b50) break;
      const nameLength = view.getUint16(26, true);
      const extraLength = view.getUint16(28, true);
      const size = view.getUint32(22, true);
      const nameBuf = Buffer.alloc(nameLength);
      await file.read(nameBuf, 0, nameLength, null);
      if (extraLength) await file.read(Buffer.alloc(extraLength), 0, extraLength, null);
      const name = nameBuf.toString('utf8');
      const hash = createHash('sha256');
      let left = size;
      while (left > 0) {
        const chunk = Buffer.alloc(Math.min(left, 64 * 1024));
        const got = await file.read(chunk, 0, chunk.length, null);
        if (!got.bytesRead) break;
        hash.update(chunk.subarray(0, got.bytesRead));
        left -= got.bytesRead;
      }
      found.set(name, { path: name, bytes: size - left, sha256: hash.digest('hex') });
    }
  } finally {
    await file.close();
  }
  const problems: string[] = [];
  for (const entry of entries) {
    const got = found.get(entry.path);
    if (!got) problems.push(`${entry.path} : absent`);
    else if (got.sha256 !== entry.sha256 || got.bytes !== entry.bytes) problems.push(`${entry.path} : empreinte fausse`);
  }
  return problems;
}

export async function readZipEntry(zipPath: string, wanted: string): Promise<Uint8Array | null> {
  const file = await open(zipPath, 'r');
  try {
    for (;;) {
      const header = Buffer.alloc(30);
      const read = await file.read(header, 0, 30, null);
      if (read.bytesRead < 30) return null;
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const signature = view.getUint32(0, true);
      if (signature !== 0x04034b50) return null;
      const nameLength = view.getUint16(26, true);
      const extraLength = view.getUint16(28, true);
      const size = view.getUint32(22, true);
      const nameBuf = Buffer.alloc(nameLength);
      await file.read(nameBuf, 0, nameLength, null);
      if (extraLength) await file.read(Buffer.alloc(extraLength), 0, extraLength, null);
      const name = nameBuf.toString('utf8');
      if (name !== wanted) {
        const skip = Buffer.alloc(64 * 1024);
        let left = size;
        while (left > 0) {
          const got = await file.read(skip, 0, Math.min(skip.length, left), null);
          if (!got.bytesRead) break;
          left -= got.bytesRead;
        }
        continue;
      }
      const data = Buffer.alloc(size);
      let filled = 0;
      while (filled < size) {
        const got = await file.read(data, filled, size - filled, null);
        if (!got.bytesRead) break;
        filled += got.bytesRead;
      }
      return new Uint8Array(data.buffer, data.byteOffset, filled);
    }
  } finally {
    await file.close();
  }
}

export async function publishPartial(partialPath: string, finalPath: string): Promise<void> {
  await stat(partialPath);
  await rename(partialPath, finalPath);
}
