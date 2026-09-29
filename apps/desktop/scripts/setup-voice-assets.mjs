#!/usr/bin/env node
/**
 * Prépare `voice-assets/` (non commité) : le runtime onnxruntime-web
 * WebAssembly partagé, le modèle Whisper `Xenova/whisper-base` (q8) et les
 * modèles openWakeWord. electron-builder copie ce dossier tel quel dans
 * `resources/` (extraResources) ; en dev, le protocole `jarvis-oww:` le lit
 * directement. La liste des fichiers vient de `@jarvis/core`
 * (`REQUIRED_VOICE_ASSETS`), la même que celle du diagnostic et d'after-pack.
 */
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { REQUIRED_VOICE_ASSETS, WHISPER_MODEL_REPO } from '@jarvis/core';

const desktopRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const assetsRoot = join(desktopRoot, 'voice-assets');
const require = createRequire(join(desktopRoot, 'package.json'));

const SOURCES = {
  whisper: (path) => `https://huggingface.co/${WHISPER_MODEL_REPO}/resolve/main/${path.slice(WHISPER_MODEL_REPO.length + 1)}`,
  openwakeword: (path) => `https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/${path}`,
};

async function download(url, destination, minBytes) {
  console.log(`[voix] téléchargement de ${url}`);
  const partial = `${destination}.part`;
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Jarvis-setup-voice' } });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} pour ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const size = statSync(partial).size;
  if (size < minBytes) throw new Error(`Fichier incomplet (${size} octets) : ${url}`);
  renameSync(partial, destination);
}

function packageRoot(name) {
  let dir = dirname(require.resolve(name));
  while (dir !== dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return dir;
    dir = dirname(dir);
  }
  throw new Error(`${name} introuvable depuis ${desktopRoot}`);
}

function readManifest(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
}

function checkSingleOnnxRuntime() {
  const ortRoot = packageRoot('onnxruntime-web');
  const ortPackage = readManifest(ortRoot);
  const transformersPackage = readManifest(packageRoot('@huggingface/transformers'));
  const expected = transformersPackage.dependencies['onnxruntime-web'];
  if (ortPackage.version !== expected) {
    throw new Error(
      `onnxruntime-web ${ortPackage.version} ≠ ${expected} (version exigée par transformers.js) : ` +
        'Whisper et openWakeWord doivent partager le même runtime.',
    );
  }
  return { version: ortPackage.version, dist: join(ortRoot, 'dist') };
}

// Anciens emplacements (0.4.10 et avant) : laissés dans public/, Vite les
// recopierait dans out/renderer et donc dans app.asar.
for (const legacy of ['whisper', 'openwakeword', 'porcupine']) {
  const dir = join(desktopRoot, 'src', 'renderer', 'public', legacy);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`[voix] ancien dossier retiré : src/renderer/public/${legacy}`);
  }
}

const ort = checkSingleOnnxRuntime();
for (const asset of REQUIRED_VOICE_ASSETS) {
  const destination = join(assetsRoot, asset.host, ...asset.path.split('/'));
  mkdirSync(dirname(destination), { recursive: true });
  if (asset.host === 'ort') {
    copyFileSync(join(ort.dist, asset.path), destination);
    continue;
  }
  if (existsSync(destination) && statSync(destination).size >= asset.minBytes) continue;
  await download(SOURCES[asset.host](asset.path), destination, asset.minBytes);
}

console.log(`[voix] voice-assets prêt : onnxruntime-web ${ort.version}, ${WHISPER_MODEL_REPO} q8, openWakeWord.`);
