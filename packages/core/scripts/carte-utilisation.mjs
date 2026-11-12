#!/usr/bin/env node
/**
 * Carte de l'utilisation réelle.
 * Aucun modèle, aucun réseau. Les sources sont lues, jamais modifiées.
 * Les phrases ne sont pas écrites.
 *
 *   npm run carte:utilisation --workspace @jarvis/core -- --conversations <dossier> --dir C:\dev\jarvis-data
 */
const here = new URL('.', import.meta.url);
let carte;
try {
  carte = await import(new URL('../dist/carte/produire.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  const conversations = [];
  let carnet = '';
  let exportClaude = '';
  let claudeCode = '';
  let dir = carte.DIR_DEFAUT;
  let rapport = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`valeur manquante après ${arg}`);
      i += 1;
      return value;
    };
    if (arg === '--conversations') conversations.push(next());
    else if (arg === '--carnet') carnet = next();
    else if (arg === '--export-claude') exportClaude = next();
    else if (arg === '--claude-code') claudeCode = next();
    else if (arg === '--dir') dir = next();
    else if (arg === '--rapport') rapport = next();
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage : npm run carte:utilisation --workspace @jarvis/core -- [options]

  --conversations <dossier>   répétables, conversations Jarvis
  --carnet <rates.jsonl>      carnet des ratés
  --export-claude <chemin>    dossier, conversations.json ou .zip
  --claude-code <dossier>     sessions .claude/projects
  --dir <dossier>             défaut : C:\\dev\\jarvis-data  (écrit <dir>/carte/)
  --rapport <fichier.md>      les chiffres seuls

Une source absente est dite, jamais une erreur.`);
      process.exit(0);
    } else throw new Error(`option inconnue : ${arg}`);
  }
  return { conversations, carnet, exportClaude, claudeCode, dir, rapport };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const resultat = await carte.produireCarte({
    conversations: args.conversations,
    carnet: args.carnet || undefined,
    exportClaude: args.exportClaude || undefined,
    claudeCode: args.claudeCode || undefined,
    dir: args.dir,
    rapport: args.rapport || undefined,
  });
  for (const ligne of resultat.journaux) console.log(ligne);
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exit(1);
}
