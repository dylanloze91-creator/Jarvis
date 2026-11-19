#!/usr/bin/env node
/**
 * Vitesse de Jarvis : lit les journaux de tour des conversations et écrit `vitesse.md`.
 * Que des chiffres. Aucun modèle, aucun réseau. Les messages ne sont jamais lus ni affichés.
 *
 *   npm run vitesse --workspace @jarvis/core -- \
 *     --conversations <dossier> [--conversations <autre>] [--dir C:\dev\jarvis-data\vitesse]
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

let mod;
try {
  mod = await import(new URL('../dist/vitesse/resume.js', import.meta.url).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  const conversations = [];
  let dir = 'C:\\dev\\jarvis-data\\vitesse';
  let name = 'vitesse.md';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--conversations') conversations.push(argv[++i] ?? '');
    else if (arg === '--dir') dir = argv[++i] ?? dir;
    else if (arg === '--name') name = argv[++i] ?? name;
    else if (arg === '--help' || arg === '-h') {
      console.log('npm run vitesse --workspace @jarvis/core -- --conversations <dossier> [--dir C:\\dev\\jarvis-data\\vitesse] [--name vitesse.md]');
      process.exit(0);
    }
  }
  return { conversations: conversations.filter(Boolean), dir, name };
}

const options = parseArgs(process.argv.slice(2));
if (options.conversations.length === 0) {
  console.error('Aucun dossier de conversations donné (--conversations <dossier>).');
  process.exit(1);
}

const entries = [];
let files = 0;
let skipped = 0;
let missing = 0;
for (const folder of options.conversations) {
  let names;
  try {
    names = (await readdir(folder)).filter((file) => file.endsWith('.json'));
  } catch {
    missing += 1;
    continue;
  }
  for (const file of names) {
    try {
      const conversation = JSON.parse(await readFile(join(folder, file), 'utf8'));
      files += 1;
      entries.push(...mod.turnLogsOf(conversation));
    } catch {
      skipped += 1;
    }
  }
}

const summary = mod.summarizeSpeed(entries);
const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
const report = mod.speedReport(summary, {
  date,
  sources: [
    `Conversations lues : ${files}${skipped ? `, illisibles : ${skipped}` : ''}${missing ? `, dossiers absents : ${missing}` : ''}.`,
  ],
});
await mkdir(options.dir, { recursive: true });
const target = join(options.dir, options.name);
await writeFile(target, report, 'utf8');
console.log(`Conversations : ${files} lue(s), ${skipped} illisible(s). Tours : ${summary.turns}, dont ${summary.timed} avec le détail des étapes.`);
console.log(`Écrit : ${target}`);
