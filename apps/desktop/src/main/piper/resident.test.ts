import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeWav, PIPER_VOICES } from '@jarvis/core';
import { ProcessPiperRunner, type PiperRunRequest } from './runner.js';
import { ResidentPiper } from './resident.js';

const voice = PIPER_VOICES[0]!;
const clip = encodeWav(new Float32Array([0, 0.2, -0.2, 0.1]), 22_050);

const FAKE = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const statePath = process.env.JARVIS_PIPER_FAKE;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
state.launches = (state.launches || 0) + 1;
const launch = state.launches;
writeFileSync(statePath, JSON.stringify(state));
const jsonMode = process.argv.includes('--json-input') || process.argv.includes('--json_input');
if (jsonMode && launch <= (state.crashResidentLaunches || 0)) process.exit(1);
const wav = Buffer.from(readFileSync(process.env.JARVIS_PIPER_WAV));
if (!jsonMode) {
  const index = process.argv.indexOf('--output_file');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  writeFileSync(process.argv[index + 1], wav);
  process.exit(0);
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl = buffer.indexOf('\\n');
  while (nl >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) {
      const obj = JSON.parse(line);
      writeFileSync(obj.output_file, wav);
      process.stdout.write(obj.output_file + '\\n');
    }
    nl = buffer.indexOf('\\n');
  }
});
`;

async function rig(crashResidentLaunches: number) {
  const dir = await mkdtemp(join(tmpdir(), 'piper-resident-'));
  const binary = join(dir, 'piper-fake.mjs');
  const statePath = join(dir, 'state.json');
  const wavPath = join(dir, 'clip.wav');
  await mkdir(dir, { recursive: true });
  await writeFile(binary, FAKE, { mode: 0o755 });
  await chmod(binary, 0o755);
  await writeFile(statePath, JSON.stringify({ launches: 0, crashResidentLaunches }));
  await writeFile(wavPath, clip);
  const previousFake = process.env.JARVIS_PIPER_FAKE;
  const previousWav = process.env.JARVIS_PIPER_WAV;
  process.env.JARVIS_PIPER_FAKE = statePath;
  process.env.JARVIS_PIPER_WAV = wavPath;
  const request = (text: string): PiperRunRequest => ({
    binaryPath: binary,
    modelPath: join(dir, 'voice.onnx'),
    espeakDataDir: dir,
    voice,
    text,
  });
  const resident = new ResidentPiper({ fallback: new ProcessPiperRunner() });
  return {
    dir,
    statePath,
    resident,
    request,
    async launches() {
      return JSON.parse(await readFile(statePath, 'utf8')).launches as number;
    },
    async restore() {
      if (previousFake === undefined) delete process.env.JARVIS_PIPER_FAKE;
      else process.env.JARVIS_PIPER_FAKE = previousFake;
      if (previousWav === undefined) delete process.env.JARVIS_PIPER_WAV;
      else process.env.JARVIS_PIPER_WAV = previousWav;
      await resident.stop();
    },
  };
}

describe('Piper résident', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
  });

  it('un seul lancement pour plusieurs phrases', async () => {
    const env = await rig(0);
    cleanups.push(env.restore);
    const first = await env.resident.synthesize(env.request('Bonjour.'));
    const second = await env.resident.synthesize(env.request('Encore une phrase.'));
    expect(Buffer.from(first).equals(Buffer.from(clip))).toBe(true);
    expect(second.byteLength).toBe(clip.byteLength);
    expect(await env.launches()).toBe(1);
  });

  it('relance une fois après un plantage, puis repli sur un processus par phrase', async () => {
    const once = await rig(1);
    cleanups.push(once.restore);
    const wav = await once.resident.synthesize(once.request('Après le plantage.'));
    expect(wav.byteLength).toBe(clip.byteLength);
    expect(await once.launches()).toBe(2);

    const fallen = await rig(9);
    cleanups.push(fallen.restore);
    const fallback = await fallen.resident.synthesize(fallen.request('Repli.'));
    expect(fallback.byteLength).toBe(clip.byteLength);
    expect(await fallen.launches()).toBe(3);
  });
});
