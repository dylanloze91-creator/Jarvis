#!/usr/bin/env node
/**
 * Préparation train / validation pour l'entraînement du trieur.
 *
 *   npm run trieur:preparer --workspace @jarvis/core -- --dir C:\\dev\\jarvis-data\\trieur
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const here = new URL('.', import.meta.url);
let prep;
let filesMod;
try {
  prep = await import(new URL('../dist/trieur/trainPrep.js', here).href);
  filesMod = await import(new URL('../dist/trieur/files.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  let dir = 'C:\\dev\\jarvis-data\\trieur';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') dir = argv[++i] ?? dir;
    else if (arg === '--help' || arg === '-h') process.exit(0);
  }
  return { dir: resolve(dir) };
}

const options = parseArgs(process.argv.slice(2));
const files = filesMod.trieurFileNames(options.dir);
const paths = prep.trieurPrepFiles(options.dir);

let training = '';
const examRaws = [];
try {
  training = await readFile(files.training, 'utf8');
  // Tous les examens (`examen.jsonl` et `examen-<nom>.jsonl`) : aucune phrase d'examen ne va dans l'entraînement.
  const examFiles = filesMod.listExamFiles(options.dir, await readdir(options.dir));
  if (!examFiles.includes(files.exam)) throw new Error('examen principal absent');
  for (const examFile of examFiles) examRaws.push(await readFile(examFile, 'utf8'));
} catch {
  console.error('Il faut entrainement.jsonl et examen.jsonl dans le dossier de données.');
  process.exit(1);
}

const extract = await import(new URL('../dist/trieur/extract.js', here).href);
const exam = examRaws
  .flatMap((raw) => raw.split(/\r?\n/))
  .filter((line) => line.trim())
  .map((line) => extract.parseExamLine(JSON.parse(line)))
  .filter(Boolean);

const lines = training.split(/\r?\n/).filter((line) => line.trim());
const result = prep.prepareTrieurTraining({ lines, exam });
if (!result.ok) {
  console.error(result.reason ?? 'Préparation refusée');
  process.exit(1);
}

const validationMod = await import(new URL('../dist/trieur/validation.js', here).href);
let validatedLines = [];
try {
  const validatedRaw = await readFile(files.validated, 'utf8');
  validatedLines = validatedRaw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => validationMod.parseValidationLine(JSON.parse(line)))
    .filter(Boolean);
} catch {
  /* valide.jsonl facultatif */
}

const split = validationMod.splitValidationLines(validatedLines, exam);
const trainRows = [...result.train.map((row) => row.line), ...split.trainLines];

await mkdir(`${options.dir}/preparation`.replace(/\\/g, '/'), { recursive: true });
await writeFile(paths.train, `${trainRows.join('\n')}${trainRows.length ? '\n' : ''}`, 'utf8');
await writeFile(paths.validation, `${result.validation.map((row) => row.line).join('\n')}\n`, 'utf8');
if (split.exam.length) {
  await writeFile(
    `${options.dir}/preparation/examen-valide.jsonl`.replace(/\\/g, '/'),
    `${split.exam.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
}
await writeFile(
  paths.resume,
  `${JSON.stringify(
    {
      kept: result.train.length + result.validation.length + split.trainLines.length,
      train: result.train.length + split.trainLines.length,
      validation: result.validation.length,
      validatedExam: split.exam.length,
      validatedTrain: split.trainLines.length,
      examFingerprint: prep.preparationFingerprint(exam),
      options: prep.TRIEUR_PREP_DEFAULTS,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
if (result.setAside.length) {
  await writeFile(
    paths.setAside,
    `${result.setAside.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
}
console.log(
  `Préparation OK : ${result.train.length + split.trainLines.length} entraînement, ${result.validation.length} validation` +
    (split.exam.length ? `, ${split.exam.length} validée(s) vers l'examen` : '') +
    '.',
);
