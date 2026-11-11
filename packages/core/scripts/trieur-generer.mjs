#!/usr/bin/env node
/**
 * Génération du cahier d'entraînement du trieur (professeur Ollama).
 *
 *   npm run trieur:generer --workspace @jarvis/core -- --model qwen2.5:7b --count 2000 --dir C:\\dev\\jarvis-data\\trieur
 */
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const here = new URL('.', import.meta.url);
let gen;
let filesMod;
let ollama;
try {
  gen = await import(new URL('../dist/trieur/generator.js', here).href);
  filesMod = await import(new URL('../dist/trieur/files.js', here).href);
  ollama = await import(new URL('../dist/trieur/ollamaRouter.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  let model = 'qwen2.5:7b';
  let count = 2000;
  let dir = 'C:\\dev\\jarvis-data\\trieur';
  let url = 'http://127.0.0.1:11434';
  let maxTries = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`valeur manquante après ${arg}`);
      i += 1;
      return v;
    };
    if (arg === '--model') model = next();
    else if (arg === '--count') count = Math.max(1, Number(next()) || 1);
    else if (arg === '--dir') dir = next();
    else if (arg === '--url') url = next().replace(/\/+$/, '');
    else if (arg === '--max-tries') maxTries = Math.max(count, Number(next()) || count);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage : trieur:generer -- --model NOM --count N [--dir …]');
      process.exit(0);
    }
  }
  return { model, count, dir: resolve(dir), url, maxTries: maxTries ?? count * 4 };
}

const options = parseArgs(process.argv.slice(2));
const files = filesMod.trieurFileNames(options.dir);
await mkdir(options.dir, { recursive: true });

const extract = await import(new URL('../dist/trieur/extract.js', here).href);
let exam = [];
try {
  // Tous les examens (`examen.jsonl` et `examen-<nom>.jsonl`) : aucune phrase d'examen ne va dans le cahier.
  const examFiles = filesMod.listExamFiles(options.dir, await readdir(options.dir));
  if (!examFiles.includes(files.exam)) throw new Error('examen principal absent');
  for (const examFile of examFiles) {
    const raw = await readFile(examFile, 'utf8');
    exam.push(
      ...raw
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => extract.parseExamLine(JSON.parse(line)))
        .filter(Boolean),
    );
  }
  console.log(`${exam.length} phrase(s) d'examen protégées (${examFiles.length} fichier(s)).`);
} catch {
  console.error(`Examen absent (${files.exam}) : génération refusée pour éviter une fuite.`);
  process.exit(1);
}

const ctx = gen.createGenerateContext(exam);
const known = new Set();
try {
  const prev = await readFile(files.training, 'utf8');
  for (const line of prev.split(/\r?\n/).filter(Boolean)) {
    const parsed = JSON.parse(line);
    known.add(gen.exactKey(parsed));
    ctx.accepted.push(parsed);
  }
} catch {
  // pas de reprise
}

const probe = await ollama.probeOllamaModel(options.model, options.url);
if (!probe.ok) {
  console.error(`${options.model} : ${probe.reason}`);
  process.exit(1);
}

const teacher = ollama.ollamaRouterModel(options.model, options.url);
let accepted = ctx.accepted.length;
let tries = 0;
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});

console.log(`Génération trieur · professeur ${options.model} · objectif ${options.count} · déjà ${accepted}`);

while (accepted < options.count && tries < options.maxTries && !stopping) {
  tries += 1;
  const seed = gen.seedFor(tries, options.model);
  const prompt = gen.teacherPrompt(seed);
  const reply = await teacher.complete({
    system: 'Tu es un générateur de données d\'entraînement. Réponds uniquement en JSON.',
    user: prompt,
  });
  const parsed = gen.parseTeacherJson(reply.text);
  if (!parsed) {
    await appendFile(files.rejects, `${JSON.stringify({ reason: 'JSON illisible', raw: reply.text.slice(0, 2000) })}\n`);
    continue;
  }
  const verdict = gen.validateGenerated(parsed, seed, ctx);
  if (!verdict.ok) {
    await appendFile(files.rejects, `${JSON.stringify({ reason: verdict.reason, seed })}\n`);
    continue;
  }
  const key = gen.exactKey(verdict.example);
  if (known.has(key)) continue;
  known.add(key);
  ctx.accepted.push(verdict.example);
  accepted += 1;
  verdict.example.meta.model = options.model;
  await appendFile(files.training, `${JSON.stringify(verdict.example)}\n`);
  if (accepted % 20 === 0) console.log(`  ${accepted} exemples…`);
}

console.log(`Terminé : ${accepted} exemple(s), ${tries} essai(s). Fichier : ${files.training}`);
