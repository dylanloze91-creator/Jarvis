#!/usr/bin/node
/**
 * Vérifie que le dossier Piper embarqué contient piper.exe, ses DLL et espeak-ng-data.
 * Usage : node scripts/verify-piper-windows-bundle.mjs [chemin/vers/piper]
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { PIPER_WINDOWS_BUNDLE_CHECKS } from '@jarvis/core';

const require = createRequire(import.meta.url);
const { verifyPiperWindowsBundle } = require('./piperWindowsBundle.cjs');

const desktopRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const piperRoot = process.argv[2] ?? join(desktopRoot, 'voice-assets', 'piper');

const problems = verifyPiperWindowsBundle(piperRoot, PIPER_WINDOWS_BUNDLE_CHECKS);
if (problems.length > 0) {
  console.error(`Piper Windows incomplet dans ${piperRoot} :`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`OK Piper Windows (${piperRoot})`);
