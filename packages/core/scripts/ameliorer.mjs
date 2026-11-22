#!/usr/bin/env node
/**
 * Boucle d'amélioration : diagnostic des ratés, temps par étape, modèle par équipe et règles
 * express proposées, chacune passée à la porte sur tout l'historique. Aucun modèle, aucun réseau.
 * Les phrases ne sont pas affichées ici ; elles restent dans les fichiers du dossier de données.
 *
 *   npm run ameliorer --workspace @jarvis/core -- \
 *     --conversations <dossier> [--carnet <rates.jsonl>] [--regle <regle.json>] [--dir C:\dev\jarvis-data]
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
  mod = await import(new URL('../dist/amelioration/fichiers.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

const AIDE =
  'npm run ameliorer --workspace @jarvis/core -- --conversations <dossier> [--carnet <rates.jsonl>] [--regle <regle.json>] [--dir C:\\dev\\jarvis-data]';

function parseArgs(argv) {
  const conversations = [];
  const regles = [];
  let carnet;
  let dir = 'C:\\dev\\jarvis-data';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--conversations') conversations.push(argv[++i] ?? '');
    else if (arg === '--carnet') carnet = argv[++i];
    else if (arg === '--regle') regles.push(argv[++i] ?? '');
    else if (arg === '--dir') dir = argv[++i] ?? dir;
    else if (arg === '--help' || arg === '-h') {
      console.log(AIDE);
      process.exit(0);
    } else {
      console.error(`Option inconnue : ${arg}`);
      console.error(AIDE);
      process.exit(2);
    }
  }
  return { conversations: conversations.filter(Boolean), regles: regles.filter(Boolean), carnet, dir };
}

const options = parseArgs(process.argv.slice(2));
if (options.conversations.length === 0) {
  console.error('Il faut au moins un dossier de conversations (--conversations).');
  console.error(AIDE);
  process.exit(2);
}

try {
  const { analyse, lecture, fichiers } = await mod.ameliorer({ ...options, depot: depotRacine() });
  console.log(`Conversations : ${lecture.conversations} lue(s), ${lecture.sautees} sautée(s), ${lecture.dossiersAbsents} dossier(s) absent(s).`);
  if (options.carnet) {
    const c = lecture.carnet;
    console.log(c.absent ? 'Carnet : absent.' : `Carnet : ${c.lignes} ligne(s), ${c.rattaches} rattachée(s) à une demande, ${c.orphelins} sans demande retrouvée.`);
  }
  console.log(`Demandes : ${analyse.tours} (${analyse.toursAvecJournal} avec le journal du tour), ${analyse.rates} avec un raté.`);
  console.log(`Familles de ratés : ${analyse.familles.length}. Outils qui ratent : ${analyse.outils.length}.`);
  const suggestions = analyse.equipes.filter((bilan) => bilan.suggestion).length;
  console.log(`Suggestions de modèle par équipe : ${suggestions}.`);
  const passent = analyse.propositions.filter((p) => p.verdict.acceptee).length;
  console.log(`Règles express proposées : ${analyse.propositions.length}, dont ${passent} qui passent la porte.`);
  for (const essai of analyse.reglesEssayees) {
    console.log(`Règle « ${essai.regle.id} » : ${essai.verdict.acceptee ? 'passe la porte' : `ne passe pas (${essai.verdict.raisons.join(' ; ')})`}.`);
  }
  for (const refus of lecture.reglesRefusees) console.log(`Règle refusée : ${refus}`);
  if (fichiers) {
    console.log(`Rapport : ${fichiers.rapport}`);
    console.log(`Exemples (tes phrases, reste sur le PC) : ${fichiers.exemples}`);
    console.log(`Comptes seulement (peut être envoyé) : ${fichiers.analyse}`);
  }
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exit(1);
}
