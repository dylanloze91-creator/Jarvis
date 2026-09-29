#!/usr/bin/env node
/**
 * Passe des enregistrements (WAV / MP3) dans la chaîne voix d'un Jarvis
 * empaqueté (`npm run package:dir`), via « Réglages → Tester la voix →
 * Analyser un fichier audio » : openWakeWord, déclencheur « Jarvis » nu
 * confirmé par Whisper, puis dictée. Aucun double du code : c'est l'appli.
 *
 *   node apps/desktop/scripts/check-voice-recordings.mjs --app release/linux-unpacked/@jarvisdesktop prise1.mp3 prise2.wav
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const appIndex = args.indexOf('--app');
if (appIndex < 0 || !args[appIndex + 1] || args.length < 3) {
  console.error('Usage : check-voice-recordings.mjs --app <exécutable empaqueté> <fichier audio>…');
  process.exit(2);
}
const bin = resolve(args[appIndex + 1]);
const files = args.filter((_, index) => index !== appIndex && index !== appIndex + 1).map((file) => resolve(file));
const port = 9555;
const config = mkdtempSync(join(tmpdir(), 'jarvis-voice-check-'));
for (const dir of ['Jarvis', '@jarvis/desktop']) {
  mkdirSync(join(config, dir), { recursive: true });
  writeFileSync(join(config, dir, 'settings.json'), JSON.stringify({ provider: 'mock', voice: { enabled: false } }));
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const child = spawn(bin, [`--remote-debugging-port=${port}`, '--no-sandbox', '--use-fake-ui-for-media-stream'], {
  env: { ...process.env, XDG_CONFIG_HOME: config },
  stdio: 'ignore',
});

async function connect() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === 'page' && /index\.html/.test(target.url));
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((ok, fail) => {
          socket.onopen = ok;
          socket.onerror = fail;
        });
        return socket;
      }
    } catch {
      // l'appli démarre encore
    }
    await sleep(500);
  }
  throw new Error('Fenêtre Jarvis introuvable (DevTools).');
}

let nextId = 0;
const pending = new Map();
function call(socket, method, params = {}) {
  nextId += 1;
  socket.send(JSON.stringify({ id: nextId, method, params }));
  return new Promise((ok, fail) => pending.set(nextId, { ok, fail }));
}
async function evaluate(socket, expression) {
  const { result, exceptionDetails } = await call(socket, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}
async function waitFor(socket, expression, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await evaluate(socket, expression).catch(() => false)) return;
    await sleep(1000);
  }
  throw new Error(`Délai dépassé : ${expression}`);
}

try {
  const socket = await connect();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.fail(new Error(message.error.message));
    else waiter.ok(message.result);
  };
  await waitFor(socket, `!!document.querySelector('[aria-label="Réglages"]')`, 30_000);
  await evaluate(socket, `document.querySelector('[aria-label="Réglages"]').click()`);
  await waitFor(socket, `!!document.querySelector('[data-testid="voice-diagnostic-file"]')`, 15_000);
  const { root } = await call(socket, 'DOM.getDocument', { depth: -1 });
  const { nodeId } = await call(socket, 'DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-testid="voice-diagnostic-file"]',
  });
  await call(socket, 'DOM.setFileInputFiles', { nodeId, files });
  await waitFor(
    socket,
    `document.querySelectorAll('[data-testid="voice-diagnostic-files"] li').length >= ${files.length} || !!document.querySelector('[data-testid="voice-diagnostic"] p.text-rose-300')`,
    files.length * 120_000,
  );
  const lines = await evaluate(
    socket,
    `[...document.querySelectorAll('[data-testid="voice-diagnostic-files"] li, [data-testid="voice-diagnostic"] p.text-rose-300')].map((node) => node.innerText.replace(/\\n+/g, ' · '))`,
  );
  for (const line of lines) console.log(line);
} finally {
  child.kill();
  rmSync(config, { recursive: true, force: true });
}
