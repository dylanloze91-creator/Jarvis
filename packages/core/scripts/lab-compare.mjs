#!/usr/bin/env node
/**
 * Examen et décision (5.0.65) : fait passer l'examen (les 29 missions du jeu `eval`) à la base
 * et au candidat avec le banc du laboratoire (`lab-bench.mjs`, réutilisé tel quel), puis compare
 * mission par mission et rend un verdict simple : « meilleur », « pareil » ou « moins bon ».
 *
 * Depuis la racine du dépôt (carte graphique réservée dans AGENTS-COORDINATION.md avant) :
 *   npm run lab:compare --workspace @jarvis/core -- --base qwen2.5-coder:7b --candidate jarvis-coder --runs 3
 *
 * Options :
 *   --base NOM          modèle de référence (défaut : qwen2.5-coder:7b)
 *   --candidate NOM     modèle entraîné à juger (défaut : jarvis-coder)
 *   --runs N            passages par modèle (défaut : 3)
 *   --attempts N        essais par mission (défaut : 2, comme le banc)
 *   --timeout S         secondes par essai (défaut : 90)
 *   --ctx N             num_ctx (défaut : 4096)
 *   --url URL           serveur Ollama (défaut : http://127.0.0.1:11434)
 *   --input FICHIER     rapport JSON d'un banc déjà fait (--set eval, les deux modèles) : rien n'est relancé
 *   --out-dir DOSSIER   où écrire le rapport (défaut : rapports/ à la racine du dépôt)
 *
 * Règle : le candidat n'est conseillé que s'il dépasse la base sur le total et ne perd pas plus de
 * 2 missions qu'elle réussissait. Rien n'est téléchargé, aucun modèle n'est remplacé : le choix reste
 * à l'utilisateur. Le rapport ne contient ni énoncé, ni fichier, ni chemin personnel.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
let compare;
try {
  compare = await import(new URL('../dist/developer/labCompare.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    base: 'qwen2.5-coder:7b',
    candidate: 'jarvis-coder',
    runs: 3,
    attempts: 2,
    timeoutS: 90,
    ctx: 4096,
    url: 'http://127.0.0.1:11434',
    input: null,
    outDir: fileURLToPath(new URL('../../../rapports/', here)),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`valeur manquante après ${arg}`);
      index += 1;
      return value;
    };
    if (arg === '--base') options.base = next();
    else if (arg === '--candidate') options.candidate = next();
    else if (arg === '--runs') options.runs = Math.max(1, Number(next()) || 1);
    else if (arg === '--attempts') options.attempts = Math.max(1, Number(next()) || 1);
    else if (arg === '--timeout') options.timeoutS = Math.max(5, Number(next()) || 90);
    else if (arg === '--ctx') options.ctx = Math.max(1024, Number(next()) || 4096);
    else if (arg === '--url') options.url = next().replace(/\/+$/, '');
    else if (arg === '--input') options.input = next();
    else if (arg === '--out-dir') options.outDir = next();
    else if (arg === '--help' || arg === '-h') {
      console.log('Voir l’en-tête de packages/core/scripts/lab-compare.mjs pour les options.');
      process.exit(0);
    } else throw new Error(`option inconnue : ${arg}`);
  }
  if (options.base === options.candidate) throw new Error('la base et le candidat doivent être deux modèles différents');
  return options;
}

/** Lance le banc tel quel (même code, mêmes réglages) et rend le chemin de son rapport complet. */
async function runBench(options) {
  const work = await mkdtemp(join(tmpdir(), 'jarvis-compare-'));
  const out = join(work, 'banc-eval.json');
  const args = [
    fileURLToPath(new URL('./lab-bench.mjs', here)),
    '--set',
    'eval',
    '--model',
    `${options.base},${options.candidate}`,
    '--runs',
    String(options.runs),
    '--attempts',
    String(options.attempts),
    '--timeout',
    String(options.timeoutS),
    '--ctx',
    String(options.ctx),
    '--url',
    options.url,
    '--out',
    out,
  ];
  console.log(`Examen : ${options.base} contre ${options.candidate} · ${options.runs} passage(s) · banc du laboratoire, jeu eval\n`);
  const code = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('exit', (exitCode) => resolvePromise(exitCode ?? 1));
    child.on('error', () => resolvePromise(1));
  });
  if (code !== 0) throw new Error(`le banc s’est arrêté avec le code ${code}`);
  return out;
}

function fileSafe(name) {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`Option refusée : ${error.message}`);
  process.exit(1);
}

let reportPath;
try {
  reportPath = options.input ? resolve(options.input) : await runBench(options);
} catch (error) {
  console.error(`Examen impossible : ${error.message}`);
  process.exit(1);
}

let comparison;
try {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  comparison = compare.compareBench(report, options.base, options.candidate);
} catch (error) {
  console.error(`Comparaison impossible : ${error.message}`);
  console.error(`Rapport du banc : ${reportPath}`);
  process.exit(1);
}

const now = new Date();
const stamp = now.toISOString().slice(0, 10);
const outDir = resolve(options.outDir);
await mkdir(outDir, { recursive: true });
const baseName = `${stamp}-examen-${fileSafe(options.candidate)}-contre-${fileSafe(options.base)}`;
const jsonPath = join(outDir, `${baseName}.json`);
const mdPath = join(outDir, `${baseName}.md`);
await writeFile(jsonPath, `${JSON.stringify(compare.comparisonReport(comparison, now), null, 2)}\n`);
await writeFile(mdPath, compare.comparisonMarkdown(comparison, now));

console.log('\n================ EXAMEN ================');
console.log(compare.comparisonText(comparison));
console.log(`\nRapport : ${mdPath}\nChiffres : ${jsonPath}`);
if (!options.input) console.log(`Détail complet du banc (non versionné, chemins temporaires) : ${reportPath}`);
console.log(
  comparison.advised
    ? `\nLe candidat est conseillé. Pour l’utiliser dans Jarvis Développeur : Réglages → Développeur → Modèle de code → choisir ${options.candidate}. Rien n’est changé automatiquement.`
    : `\nLe candidat n’est pas conseillé : garder ${options.base}. Pour retirer le candidat : ollama rm ${options.candidate}.`,
);
