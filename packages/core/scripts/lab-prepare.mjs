#!/usr/bin/env node
/**
 * Préparation des données d'entraînement de l'élève (5.0.65) : lit le cahier d'exercices
 * (`entrainement.jsonl`, `exercices.jsonl`), écarte ce qui ne doit pas servir, découpe en
 * train / validation et écrit le résumé. Aucun modèle n'est appelé, rien n'est téléchargé.
 *
 * Depuis la racine du dépôt :
 *   npm run lab:prepare --workspace @jarvis/core -- --dir C:\dev\jarvis-data
 *
 * Options :
 *   --dir DOSSIER       dossier des données (défaut : ./jarvis-data) ; lit entrainement.jsonl et exercices.jsonl
 *   --out DOSSIER       dossier de sortie (défaut : <dir>/preparation) ; écrit train.jsonl, validation.jsonl,
 *                       ecartes.jsonl (ligne, identifiant, raison) et resume.json
 *   --max-tokens N      plafond de longueur d'un exemple, en jetons estimés (défaut : 3072)
 *   --validation PART   part du jeu de validation, entre 0 et 0,5 (défaut : 0.1), répartie par niveau
 *   --seed N            graine de la découpe (défaut : 5065) ; même cahier, même graine → même découpe
 *   --min N             nombre minimal d'exemples gardés, sinon la préparation est refusée (défaut : 100)
 *
 * Les lignes gardées sont réécrites à l'identique : rien n'est ajouté ni corrigé dans une donnée.
 * Un exemple proche d'une mission de l'examen (evalCatalog) est écarté et listé.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url);
let prep;
try {
  prep = await import(new URL('../dist/developer/labTrainPrep.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  const options = { dir: 'jarvis-data', out: null, maxTokens: null, validationShare: null, seed: null, minKept: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`valeur manquante après ${arg}`);
      index += 1;
      return value;
    };
    const number = (label, min, max) => {
      const value = Number(next());
      if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} doit être un nombre entre ${min} et ${max}`);
      return value;
    };
    if (arg === '--dir') options.dir = next();
    else if (arg === '--out') options.out = next();
    else if (arg === '--max-tokens') options.maxTokens = Math.floor(number('--max-tokens', 256, 1_000_000));
    else if (arg === '--validation') options.validationShare = number('--validation', 0, 0.5);
    else if (arg === '--seed') options.seed = Math.floor(number('--seed', 0, 4_294_967_295));
    else if (arg === '--min') options.minKept = Math.floor(number('--min', 1, 1_000_000));
    else if (arg === '--help' || arg === '-h') {
      console.log('Voir l’en-tête de packages/core/scripts/lab-prepare.mjs pour les options.');
      process.exit(0);
    } else throw new Error(`option inconnue : ${arg}`);
  }
  return options;
}

async function readLines(path) {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter((line) => line.trim());
  } catch {
    return [];
  }
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`Option refusée : ${error.message}`);
  process.exit(1);
}

const dir = resolve(options.dir);
const out = resolve(options.out ?? join(dir, 'preparation'));
const examplesPath = join(dir, 'entrainement.jsonl');
const exercisesPath = join(dir, 'exercices.jsonl');
const exampleLines = await readLines(examplesPath);
const exerciseLines = await readLines(exercisesPath);
if (exampleLines.length === 0) {
  console.error(`Aucun exemple dans ${examplesPath}. Le cahier se remplit avec « npm run lab:generate --workspace @jarvis/core ».`);
  process.exit(1);
}
if (exerciseLines.length === 0) console.log(`Avertissement : ${exercisesPath} absent ou vide, le niveau viendra des exemples eux-mêmes.`);

const prepOptions = {
  ...(options.maxTokens !== null ? { maxTokens: options.maxTokens } : {}),
  ...(options.validationShare !== null ? { validationShare: options.validationShare } : {}),
  ...(options.seed !== null ? { seed: options.seed } : {}),
  ...(options.minKept !== null ? { minKept: options.minKept } : {}),
};
console.log(`Préparation : ${exampleLines.length} exemple(s) dans ${examplesPath}, ${exerciseLines.length} exercice(s) dans ${exercisesPath}`);
const result = prep.prepareTrainingData({ exampleLines, exerciseLines, options: prepOptions });
const { summary } = result;

const reasons = Object.entries(summary.setAside.byReason).sort((a, b) => b[1] - a[1]);
console.log(`  gardés : ${summary.kept} · écartés : ${summary.setAside.total}${reasons.length ? ` (${reasons.map(([reason, count]) => `${reason} ×${count}`).join(' · ')})` : ''}`);
for (const item of result.setAside.slice(0, 20)) console.log(`    ✘ ligne ${item.line}${item.id ? ` · ${item.id}` : ''} · ${item.reason}`);
if (result.setAside.length > 20) console.log(`    … et ${result.setAside.length - 20} autre(s)`);

if (!result.ok) {
  console.error(`\n${result.reason}`);
  console.error('Rien n’a été écrit.');
  process.exit(1);
}

await mkdir(out, { recursive: true });
const files = prep.preparationFiles(result);
for (const [name, content] of Object.entries(files)) await writeFile(join(out, name), content);

const levels = (counts) => `niv. 1 : ${counts[1]} · niv. 2 : ${counts[2]} · niv. 3 : ${counts[3]}`;
console.log('\n================ RÉSUMÉ ================');
console.log(`Entraînement : ${summary.train} exemple(s) (${levels(summary.levels.train)})`);
console.log(`Validation   : ${summary.validation} exemple(s) (${levels(summary.levels.validation)})`);
console.log(`Thèmes       : ${summary.themes} (un thème entier va du même côté de la découpe)`);
console.log(`Longueur (jetons estimés) : min ${summary.tokens.min}, médiane ${summary.tokens.median}, max ${summary.tokens.max}, plafond ${summary.tokens.cap}`);
for (const warning of summary.warnings) console.log(`  ⚠ ${warning}`);
console.log(`Fichiers écrits dans ${out} : ${Object.keys(files).join(', ')}`);
console.log('Étape suivante : training\\setup-windows.ps1 (une fois), puis training\\train_lora.py (voir training\\README.md).');
