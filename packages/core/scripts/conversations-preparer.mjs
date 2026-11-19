#!/usr/bin/env node
/**
 * Prépare le jeu d'entraînement tiré des conversations. Aucun modèle, aucun réseau.
 * Les phrases ne sont pas affichées.
 *
 *   npm run conversations:preparer --workspace @jarvis/core -- \
 *     --conversations <dossier> [--carnet <rates.jsonl>] [--dir C:\dev\jarvis-data]
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);

function depotRacine() {
  let dir = here;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(new URL('.git', dir))) return fileURLToPath(dir);
    dir = new URL('../', dir);
  }
  return undefined;
}

let mod;
try {
  mod = await import(new URL('../dist/conversations/preparer.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  const conversations = [];
  let carnet;
  let dir = 'C:\\dev\\jarvis-data';
  let validation = 0.1;
  let seed = 5066;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--conversations') conversations.push(argv[++i] ?? '');
    else if (arg === '--carnet') carnet = argv[++i];
    else if (arg === '--dir') dir = argv[++i] ?? dir;
    else if (arg === '--validation') validation = Number(argv[++i]);
    else if (arg === '--seed') seed = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log('npm run conversations:preparer --workspace @jarvis/core -- --conversations <dossier> [--carnet <fichier>] [--dir C:\\dev\\jarvis-data] [--validation 0.1] [--seed 5066]');
      process.exit(0);
    }
  }
  return { conversations: conversations.filter(Boolean), carnet, dir, validation, seed };
}

const options = parseArgs(process.argv.slice(2));
try {
  const resultat = await mod.preparerConversations({
    ...options,
    depot: depotRacine(),
  });
  const resume = resultat.resume;
  console.log(`Conversations : ${resume.conversations.lues} lue(s), ${resume.conversations.sautees} sautée(s), ${resume.conversations.absentes} absente(s).`);
  console.log(`Carnet : ${resume.carnet.lignes} ligne(s), ${resume.carnet.ignorees} ignorée(s)${resume.carnet.absent ? ', absent' : ''}.`);
  console.log(`Gardés : ${resume.gardes.trieur} trieur, ${resume.gardes.reponses} réponses, ${resume.gardes.aCorriger} à corriger, ${resume.ecartes} écartés.`);
  console.log(`Écrit : ${resultat.fichiers.resume}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
