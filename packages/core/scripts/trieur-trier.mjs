#!/usr/bin/env node
/**
 * Page locale de tri de l'examen du trieur (127.0.0.1, port libre).
 *
 *   npm run trieur:trier --workspace @jarvis/core -- --dir C:\\dev\\jarvis-data\\trieur [--examen <nom>]
 *
 * `--examen <nom>` trie `a-trier-<nom>.jsonl` vers `examen-<nom>.jsonl` (progression `tri-progress-<nom>.json`).
 */
import { resolve } from 'node:path';

const here = new URL('.', import.meta.url);
let SortServer;
try {
  ({ TrieurSortServer: SortServer } = await import(new URL('../dist/trieur/sortServer.js', here).href));
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  let dir = 'C:\\dev\\jarvis-data\\trieur';
  let examName = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`valeur manquante après ${arg}`);
      i += 1;
      return v;
    };
    if (arg === '--dir') dir = next();
    else if (arg === '--examen') examName = next();
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage : trieur:trier -- [--dir <données>] [--examen <nom>]');
      process.exit(0);
    }
  }
  return { dir: resolve(dir), examName };
}

const options = parseArgs(process.argv.slice(2));
const files = (await import(new URL('../dist/trieur/files.js', here).href)).trieurFileNames(options.dir, options.examName || undefined);

const server = new SortServer({
  toSortPath: files.toSort,
  examPath: files.exam,
  progressPath: files.sortProgress,
  log: (line) => console.log(line),
});

const { url } = await server.start();
console.log(`Ouvre ${url} dans ton navigateur. Ctrl+C pour arrêter (la progression est enregistrée).`);

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) return;
  stopping = true;
  void server.stop().then(() => process.exit(0));
});
