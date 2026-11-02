#!/usr/bin/env node
/**
 * Extraction des phrases utilisateur pour l'examen du trieur (5.0.68).
 *
 *   npm run trieur:extraire --workspace @jarvis/core -- --conversations <dossier> --dir C:\\dev\\jarvis-data\\trieur
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url);
let trieur;
try {
  trieur = await import(new URL('../dist/trieur/extract.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  let conversations = '';
  let dir = 'C:\\dev\\jarvis-data\\trieur';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`valeur manquante après ${arg}`);
      i += 1;
      return v;
    };
    if (arg === '--conversations') conversations = next();
    else if (arg === '--dir') dir = next();
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage : trieur:extraire -- --conversations <dossier> [--dir <données>]');
      process.exit(0);
    }
  }
  if (!conversations) throw new Error('option --conversations obligatoire');
  return { conversations: resolve(conversations), dir: resolve(dir) };
}

const options = parseArgs(process.argv.slice(2));
const files = (await import(new URL('../dist/trieur/files.js', here).href)).trieurFileNames(options.dir);
await mkdir(options.dir, { recursive: true });

let jsonFiles = [];
try {
  jsonFiles = (await readdir(options.conversations)).filter((name) => name.endsWith('.json'));
} catch {
  console.error(`Dossier introuvable : ${options.conversations}`);
  process.exit(1);
}

const conversations = [];
for (const file of jsonFiles) {
  try {
    conversations.push(JSON.parse(await readFile(join(options.conversations, file), 'utf8')));
  } catch {
    // fichier corrompu ignoré
  }
}

const lines = trieur.extractFromConversations(conversations);
const body = `${lines.map((line) => JSON.stringify(line)).join('\n')}${lines.length ? '\n' : ''}`;
await writeFile(files.toSort, body, 'utf8');
console.log(`${lines.length} phrase(s) écrites dans ${files.toSort}`);
