import { deflateRawSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readZipEntries, tarGz, zipToTarGz } from './zipToTarGz.mjs';

/** Petit zip écrit à la main : une entrée stockée, une compressée, un dossier. */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = file.directory ? Buffer.alloc(0) : Buffer.from(file.data);
    const stored = file.method === 0 || file.directory;
    const body = stored ? data : deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

function readTar(buffer) {
  const files = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const block = buffer.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) break;
    const name = block.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const prefix = block.toString('utf8', 345, 500).replace(/\0.*$/s, '');
    const size = parseInt(block.toString('ascii', 124, 136).replace(/\0.*$/s, ''), 8);
    const type = block.toString('ascii', 156, 157);
    const stored = parseInt(block.toString('ascii', 148, 154), 8);
    const check = Buffer.from(block);
    check.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of check) sum += byte;
    files.push({ name: prefix ? `${prefix}/${name}` : name, size, type, checksumOk: sum === stored, magic: block.toString('ascii', 257, 262) });
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === '0') files.at(-1).data = buffer.subarray(offset - Math.ceil(size / 512) * 512, offset - Math.ceil(size / 512) * 512 + size).toString();
  }
  return files;
}

describe('modèle Vosk : zip → tar.gz', () => {
  const zip = buildZip([
    { name: 'vosk-model-small-fr-0.22/', directory: true },
    { name: 'vosk-model-small-fr-0.22/conf/model.conf', data: '--min-active=200\n', method: 0 },
    { name: 'vosk-model-small-fr-0.22/graph/words.txt', data: 'jarvis 1\n'.repeat(500), method: 8 },
  ]);

  it('lit les entrées stockées et compressées', () => {
    const entries = readZipEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual([
      'vosk-model-small-fr-0.22/',
      'vosk-model-small-fr-0.22/conf/model.conf',
      'vosk-model-small-fr-0.22/graph/words.txt',
    ]);
    expect(entries[2].data.toString()).toBe('jarvis 1\n'.repeat(500));
  });

  it('écrit un tar ustar valide avec le dossier de premier niveau', () => {
    const files = readTar(gunzipSync(zipToTarGz(zip)));
    expect(files.map((file) => [file.name, file.type, file.checksumOk, file.magic])).toEqual([
      ['vosk-model-small-fr-0.22/', '5', true, 'ustar'],
      ['vosk-model-small-fr-0.22/conf/model.conf', '0', true, 'ustar'],
      ['vosk-model-small-fr-0.22/graph/words.txt', '0', true, 'ustar'],
    ]);
    expect(files[1].data).toBe('--min-active=200\n');
  });

  it('coupe un chemin long entre préfixe et nom', () => {
    const long = `${'a'.repeat(60)}/${'b'.repeat(60)}/final.mdl`;
    const files = readTar(gunzipSync(tarGz([{ name: long, data: Buffer.from('x'), directory: false }])));
    expect(files[0].name).toBe(long);
  });

  it('refuse une archive qui n’est pas un zip', () => {
    expect(() => readZipEntries(Buffer.from('pas un zip du tout, vraiment pas'))).toThrow(/illisible/);
  });
});
