#!/usr/bin/env node
/**
 * Banc de vitesse : compare deux passages enregistrés (avant / après un outil).
 *
 *   npm run vitesse:comparer --workspace @jarvis/core -- <avant.json> <apres.json> [--detail]
 *
 * Les passages sont écrits par `npm run banc:vitesse --workspace @jarvis/desktop`.
 */
import { readFile } from 'node:fs/promises';

let mod;
try {
  mod = await import(new URL('../dist/vitesse/banc.js', import.meta.url).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

const args = process.argv.slice(2);
const detail = args.includes('--detail');
const files = args.filter((arg) => !arg.startsWith('--'));
if (files.length < 1) {
  console.error('npm run vitesse:comparer --workspace @jarvis/core -- <avant.json> [<apres.json>] [--detail]');
  process.exit(1);
}

const runs = [];
for (const file of files) {
  const run = mod.parseBenchRun(JSON.parse(await readFile(file, 'utf8')));
  if (!run) {
    console.error(`Passage illisible : ${file}`);
    process.exit(1);
  }
  runs.push(run);
}

for (let index = 1; index < runs.length; index += 1) console.log(mod.compareBenchRuns(runs[index - 1], runs[index]));
if (detail || runs.length === 1) for (const run of runs) console.log(mod.benchRunTable(run));
