#!/usr/bin/env node
/**
 * Banc du trieur : passe l'examen sur un ou plusieurs modèles Ollama.
 *
 *   npm run trieur:banc --workspace @jarvis/core -- --dir C:\\dev\\jarvis-data\\trieur --model qwen2.5:7b,qwen2.5:3b
 *
 * `--examen <nom>` passe l'examen `examen-<nom>.jsonl` (rapport `<date>-trieur-banc-<nom>.json`) ; les phrases validées
 * en direct (`valide.jsonl`) ne sont comptées qu'avec l'examen principal.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const here = new URL('.', import.meta.url);
let bench;
let ollama;
let filesMod;
try {
  bench = await import(new URL('../dist/trieur/bench.js', here).href);
  ollama = await import(new URL('../dist/trieur/ollamaRouter.js', here).href);
  filesMod = await import(new URL('../dist/trieur/files.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  let dir = 'C:\\dev\\jarvis-data\\trieur';
  let models = ['qwen2.5:7b'];
  let url = 'http://127.0.0.1:11434';
  let out = null;
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
    else if (arg === '--model' || arg === '--models') {
      models = next()
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    } else if (arg === '--url') url = next().replace(/\/+$/, '');
    else if (arg === '--out') out = next();
    else if (arg === '--examen') examName = next();
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage : trieur:banc -- [--dir <données>] --model a,b [--url URL] [--out rapport.json] [--examen <nom>]');
      process.exit(0);
    }
  }
  return { dir: resolve(dir), models, url, out, examName };
}

const options = parseArgs(process.argv.slice(2));
const files = filesMod.trieurFileNames(options.dir, options.examName || undefined);
const extract = await import(new URL('../dist/trieur/extract.js', here).href);

let examRaw = '';
try {
  examRaw = await readFile(files.exam, 'utf8');
} catch {
  console.error(`Examen absent : ${files.exam}. Lance d'abord le tri (trieur:trier).`);
  process.exit(1);
}

const examLines = examRaw
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => extract.parseExamLine(JSON.parse(line)))
  .filter(Boolean);
const exam = bench.filterExamForBench(examLines);
if (!exam.length) {
  console.error('Aucune phrase classée dans une équipe pour le banc.');
  process.exit(1);
}

const validationMod = await import(new URL('../dist/trieur/validation.js', here).href);
let liveExam = [];
try {
  if (options.examName) throw new Error('validées en direct : examen principal seulement');
  const validatedRaw = await readFile(files.validated, 'utf8');
  const validatedLines = validatedRaw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => validationMod.parseValidationLine(JSON.parse(line)))
    .filter(Boolean);
  liveExam = bench.filterExamForBench(validationMod.splitValidationLines(validatedLines, examLines).exam);
} catch {
  /* valide.jsonl absent */
}

const report = {
  at: new Date().toISOString(),
  exam: options.examName || undefined,
  examLines: exam.length,
  liveExamLines: liveExam.length || undefined,
  models: [],
  liveModels: liveExam.length ? [] : undefined,
};

for (const modelName of options.models) {
  const probe = await ollama.probeOllamaModel(modelName, options.url);
  if (!probe.ok) {
    report.models.push({
      model: modelName,
      skipped: probe.reason,
      total: 0,
      correct: 0,
      byTeam: {},
      confusion: {},
      unreadable: 0,
      loadMs: null,
      meanPhraseMs: null,
      gpuFraction: null,
    });
    console.log(`⊘ ${modelName} : ${probe.reason}`);
    continue;
  }
  const router = ollama.ollamaRouterModel(modelName, options.url);
  const result = await bench.benchModel(router, exam);
  report.models.push(result);
  console.log(bench.benchSummaryText({ at: report.at, examLines: report.examLines, liveExamLines: report.liveExamLines, models: [result] }));
  if (liveExam.length) {
    const liveResult = await bench.benchModel(router, liveExam);
    report.liveModels?.push(liveResult);
  }
}

const stamp = report.at.slice(0, 10);
const suffix = options.examName ? `-${options.examName}` : '';
const outPath = options.out ?? join(process.cwd(), 'rapports', `${stamp}-trieur-banc${suffix}.json`);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const summaryPath = outPath.replace(/\.json$/i, '.txt');
await writeFile(summaryPath, `${bench.benchSummaryText(report)}\n`, 'utf8');
console.log(`Rapport : ${outPath}`);
