#!/usr/bin/env node
/**
 * Point d'entrée demandé pour openWakeWord. Il ne télécharge rien lui-même :
 * le runtime ONNX, Whisper et les modèles passent par setup-voice-assets.mjs,
 * pour ne jamais installer un second onnxruntime.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(here, 'setup-voice-assets.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
