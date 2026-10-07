#!/usr/bin/env node
/**
 * Mesure la dictée sur un enregistrement avec le même pré-traitement que l'app.
 * Usage : node apps/desktop/scripts/bench-whisper-fixture.mjs <fichier audio>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from '@huggingface/transformers';

const require = createRequire(import.meta.url);
const {
  attenuateClipping,
  normalizeDictationLevel,
  preprocessDictationPcm,
  refineFrenchDictation,
} = require('@jarvis/core');

const input = process.argv[2];
if (!input) {
  console.error('Usage : bench-whisper-fixture.mjs <fichier audio>');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'jarvis-whisper-bench-'));
const pcmPath = join(dir, 'audio.f32le');
execFileSync(
  'ffmpeg',
  ['-y', '-i', input, '-ar', '16000', '-ac', '1', '-f', 'f32le', pcmPath],
  { stdio: 'ignore' },
);
const raw = new Float32Array(readFileSync(pcmPath).buffer);
const pcm = attenuateClipping(normalizeDictationLevel(raw)).pcm;
const chunk_length_s = pcm.length / 16000 <= 15 ? 0 : 30;

const started = Date.now();
const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { dtype: 'q8' });
const out = await asr(pcm, {
  language: 'french',
  task: 'transcribe',
  max_new_tokens: 96,
  temperature: 0,
  chunk_length_s,
});
const rawText = (Array.isArray(out) ? out[0] : out)?.text?.trim() ?? '';
const text = refineFrenchDictation(rawText);
console.log(JSON.stringify({ ms: Date.now() - started, rawText, text }));
rmSync(dir, { recursive: true, force: true });
