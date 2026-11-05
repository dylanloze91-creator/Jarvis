import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeWav } from '@jarvis/core';
import { ProcessPiperRunner, type PiperRunRequest } from './runner.js';

describe('ProcessPiperRunner', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('rattrape EPIPE si le binaire s’arrête avant de lire stdin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-piper-runner-'));
    dirs.push(dir);
    // Windows ne lance pas un script .sh (spawn EFTYPE) : node lui-même, qui refuse
    // l'option --model et s'arrête avant de lire stdin, joue le binaire qui échoue.
    let binaryPath = process.execPath;
    if (process.platform !== 'win32') {
      binaryPath = join(dir, 'piper-fail.sh');
      writeFileSync(binaryPath, '#!/bin/sh\nexit 1\n', 'utf8');
      chmodSync(binaryPath, 0o755);
    }
    const runner = new ProcessPiperRunner();
    const request: PiperRunRequest = {
      binaryPath,
      modelPath: join(dir, 'model.onnx'),
      espeakDataDir: dir,
      voice: { id: 'x', label: 'x', modelFile: 'model.onnx', speaker: 0 },
      text: 'Bonjour',
      timeoutMs: 5_000,
    };
    await expect(runner.synthesize(request)).rejects.toThrow(/Piper a échoué|EPIPE|écriture stdin/i);
  });
});

describe('FakePiperRunner', () => {
  it('retourne les octets fournis', async () => {
    const wav = encodeWav(new Float32Array([0]), 22_050);
    const runner = new (await import('./runner.js')).FakePiperRunner(wav);
    const bytes = await runner.synthesize({} as never);
    expect(bytes).toBe(wav);
  });
});
