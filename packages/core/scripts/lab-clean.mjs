#!/usr/bin/env node
/**
 * Nettoyage du cahier d'exercices (5.0.59). Repasse les contrôles ajoutés après la première
 * nuit sur les exercices déjà acceptés : quasi-doublons et tests trop faibles.
 *
 * Depuis la racine du dépôt :
 *   npm run lab:clean --workspace @jarvis/core -- --dir C:\dev\jarvis-data
 *
 * Options :
 *   --dir DOSSIER     dossier des données (défaut : ./jarvis-data)
 *   --dry-run         montre ce qui serait écarté, sans rien écrire
 *   --no-strength     ne contrôle que les quasi-doublons
 *
 * Rien n'est supprimé : avant d'écrire, exercices.jsonl et entrainement.jsonl sont copiés en
 * *.avant-nettoyage.jsonl, et chaque exercice écarté va dans ecartes.jsonl avec sa raison.
 * Aucun modèle n'est appelé.
 */
import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url);
let gen;
try {
  gen = await import(new URL('../dist/developer/labGenerator.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

const options = { dir: 'jarvis-data', dryRun: false, strength: true };
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--dir') {
    const value = argv[index + 1];
    if (!value) {
      console.error('Option refusée : valeur manquante après --dir');
      process.exit(1);
    }
    options.dir = value;
    index += 1;
  } else if (arg === '--dry-run') options.dryRun = true;
  else if (arg === '--no-strength') options.strength = false;
  else {
    console.error(`Option refusée : option inconnue : ${arg}`);
    process.exit(1);
  }
}

async function readLines(path) {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const dir = resolve(options.dir);
const files = {
  exercises: join(dir, 'exercices.jsonl'),
  examples: join(dir, 'entrainement.jsonl'),
  setAside: join(dir, 'ecartes.jsonl'),
};
const exerciseLines = await readLines(files.exercises);
const exampleLines = await readLines(files.examples);
if (exerciseLines.length === 0) {
  console.error(`Aucun exercice dans ${files.exercises}.`);
  process.exit(1);
}

const workParent = await mkdtemp(join(tmpdir(), 'jarvis-clean-'));
const kept = [];
const keptLines = [];
const setAside = [];
const families = new Map();
console.log(`Nettoyage : ${exerciseLines.length} exercice(s) dans ${files.exercises}${options.dryRun ? ' (essai à blanc)' : ''}`);
try {
  for (const line of exerciseLines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      keptLines.push(line);
      continue;
    }
    if (!row?.mission) {
      keptLines.push(line);
      continue;
    }
    const mission = row.mission;
    let reason = null;
    let detail;
    const novel = gen.noveltyCheck(mission, kept);
    if (!novel.ok) reason = novel.reason;
    let strength = null;
    if (!reason && options.strength) {
      strength = await gen.testStrength(mission, row.solution ?? [], workParent);
      if (gen.weakTests(strength)) {
        reason = `tests trop faibles (${strength.killed} erreur(s) glissée(s) vue(s) sur ${strength.total})`;
        detail = strength.survivors.join(' ; ');
      }
    }
    if (reason) {
      setAside.push({ id: mission.id, reason, ...(detail ? { detail } : {}), row });
      const family = reason.replace(/ \(.*\)$/, '').replace(/^doublon de .*/, 'quasi-doublon');
      families.set(family, (families.get(family) ?? 0) + 1);
      console.log(`  ✘ ${mission.id} · ${reason}`);
      continue;
    }
    if (strength) row.strength = { total: strength.total, killed: strength.killed };
    kept.push({ ...mission, ...(row.provenance?.seed?.theme ? { theme: row.provenance.seed.theme } : {}) });
    keptLines.push(JSON.stringify(row));
  }
} finally {
  await rm(workParent, { recursive: true, force: true });
}

const removedIds = new Set(setAside.map((item) => item.id));
const keptExamples = exampleLines.filter((line) => {
  try {
    return !removedIds.has(JSON.parse(line)?.meta?.mission);
  } catch {
    return true;
  }
});

if (!options.dryRun && setAside.length) {
  // La première copie est gardée : un second nettoyage ne l'écrase pas.
  const keepFirst = async (from, to) => {
    if (!existsSync(to)) await copyFile(from, to);
  };
  await keepFirst(files.exercises, join(dir, 'exercices.avant-nettoyage.jsonl'));
  if (exampleLines.length) await keepFirst(files.examples, join(dir, 'entrainement.avant-nettoyage.jsonl'));
  await writeFile(files.exercises, keptLines.map((line) => `${line}\n`).join(''));
  await writeFile(files.examples, keptExamples.map((line) => `${line}\n`).join(''));
  const at = new Date().toISOString();
  await appendFile(
    files.setAside,
    setAside.map((item) => `${JSON.stringify({ at, id: item.id, reason: item.reason, ...(item.detail ? { detail: item.detail } : {}), exercise: item.row })}\n`).join(''),
  );
}

console.log('\n================ RÉSUMÉ ================');
console.log(
  `${kept.length} exercice(s) gardé(s), ${setAside.length} écarté(s)` +
    (families.size ? ` : ${[...families].map(([name, count]) => `${name} ×${count}`).join(' · ')}` : '') +
    '.',
);
console.log(`Exemples d’entraînement : ${exampleLines.length} → ${keptExamples.length}.`);
if (options.dryRun) console.log('Essai à blanc : rien n’a été écrit.');
else if (setAside.length) console.log(`Copies avant nettoyage : exercices.avant-nettoyage.jsonl, entrainement.avant-nettoyage.jsonl · écartés : ${files.setAside}`);
else console.log('Rien à écarter : aucun fichier modifié.');
