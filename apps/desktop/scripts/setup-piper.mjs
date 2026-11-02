#!/usr/bin/node
/**
 * Télécharge le binaire Piper précompilé (espeak-ng embarqué, jamais lié à
 * l'application) et les modèles ONNX français vérifiés par SHA-256.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  PIPER_LINUX_X64_ARCHIVE_SHA256,
  PIPER_LINUX_X64_URL,
  PIPER_MODEL_ASSETS,
  PIPER_WINDOWS_X64_ARCHIVE_SHA256,
  PIPER_WINDOWS_X64_URL,
} from '@jarvis/core';
import { sha256 } from './zipToTarGz.mjs';

const desktopRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const piperRoot = join(desktopRoot, 'voice-assets', 'piper');

async function download(url, destination, expectedSha256, minBytes) {
  if (existsSync(destination) && statSync(destination).size >= minBytes) {
    const digest = sha256(readFileSync(destination));
    if (digest === expectedSha256) {
      console.log(`[piper] déjà présent : ${destination}`);
      return;
    }
    console.log(`[piper] empreinte incorrecte, retéléchargement : ${destination}`);
  }
  console.log(`[piper] téléchargement de ${url}`);
  const partial = `${destination}.part`;
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Jarvis-setup-piper' } });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} pour ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const bytes = readFileSync(partial);
  const digest = sha256(bytes);
  if (digest !== expectedSha256) {
    rmSync(partial, { force: true });
    throw new Error(`Empreinte inattendue pour ${url} : ${digest} (attendu ${expectedSha256})`);
  }
  if (bytes.length < minBytes) throw new Error(`Archive Piper incomplète (${bytes.length} octets)`);
  renameSync(partial, destination);
}

function extractLinux(archivePath, destinationDir) {
  mkdirSync(destinationDir, { recursive: true });
  execFileSync('tar', ['-xzf', archivePath, '-C', destinationDir], { stdio: 'inherit' });
}

function extractWindows(archivePath, destinationDir) {
  mkdirSync(destinationDir, { recursive: true });
  execFileSync('unzip', ['-o', archivePath, '-d', destinationDir], { stdio: 'inherit' });
}

async function prepareBinary() {
  const platform = process.platform;
  if (platform === 'linux') {
    const archive = join(piperRoot, 'cache', 'piper_linux_x86_64.tar.gz');
    mkdirSync(dirname(archive), { recursive: true });
    await download(PIPER_LINUX_X64_URL, archive, PIPER_LINUX_X64_ARCHIVE_SHA256, 5_000_000);
    const dest = join(piperRoot, 'bin', 'linux-x64');
    const binary = join(dest, 'piper', 'piper');
    if (!existsSync(binary)) {
      rmSync(dest, { recursive: true, force: true });
      extractLinux(archive, dest);
    }
    return;
  }
  if (platform === 'win32') {
    const archive = join(piperRoot, 'cache', 'piper_windows_amd64.zip');
    mkdirSync(dirname(archive), { recursive: true });
    await download(PIPER_WINDOWS_X64_URL, archive, PIPER_WINDOWS_X64_ARCHIVE_SHA256, 5_000_000);
    const dest = join(piperRoot, 'bin', 'win-x64');
    const binary = join(dest, 'piper', 'piper.exe');
    if (!existsSync(binary)) {
      rmSync(dest, { recursive: true, force: true });
      extractWindows(archive, dest);
    }
    return;
  }
  console.log('[piper] plateforme non supportée pour le binaire Piper : téléchargement ignoré (tests simulés).');
}

async function prepareModels() {
  const modelsDir = join(piperRoot, 'models');
  mkdirSync(modelsDir, { recursive: true });
  for (const model of PIPER_MODEL_ASSETS) {
    const onnxPath = join(modelsDir, model.onnx);
    const jsonPath = join(modelsDir, model.json);
    await download(model.onnxUrl, onnxPath, model.onnxSha256, model.minOnnxBytes);
    await download(model.jsonUrl, jsonPath, model.jsonSha256, 100);
  }
}

await prepareBinary();
await prepareModels();
console.log('[piper] voice-assets/piper prêt.');
