#!/usr/bin/env node
/**
 * Générateur d'exercices (5.0.56) : un modèle « professeur » invente des exercices,
 * Jarvis les vérifie, et chaque exercice accepté devient un exemple d'entraînement.
 * Fait pour tourner la nuit : chaque exercice accepté est écrit tout de suite, une
 * interruption (Ctrl+C) ne perd rien, et une relance reprend sans doublon.
 *
 * Depuis la racine du dépôt :
 *   npm run lab:generate --workspace @jarvis/core -- --model qwen3-coder:30b --count 200 --dir C:\dev\jarvis-data
 *
 * Options :
 *   --model NOM       professeur Ollama (défaut : qwen3-coder:30b)
 *   --count N         exercices acceptés visés pour cette séance (défaut : 50)
 *   --max-tries N     essais au plus (défaut : 4 × count)
 *   --dir DOSSIER     dossier des données (défaut : ./jarvis-data) ; fichiers écrits :
 *                     exercices.jsonl (exercices + solutions), entrainement.jsonl (exemples),
 *                     rejets.jsonl (réponses refusées et raison, pour améliorer la consigne)
 *   --timeout S       secondes par exercice (défaut : 600)
 *   --temperature T   créativité du professeur (défaut : 0.7)
 *   --ctx N           num_ctx (défaut : 8192)
 *   --think           laisse la réflexion des modèles Qwen3 qui la gèrent (défaut : coupée)
 *   --no-strength     pas de contrôle de solidité des tests (5.0.59 : par défaut, de petites erreurs sont
 *                     glissées dans la solution ; si les tests en voient moins d’un tiers, l’exercice est refusé
 *                     ou renvoyé au professeur pour qu’il ajoute des tests)
 *   --no-repair       pas de seconde chance (5.0.57 : par défaut, un exercice refusé pour une raison
 *                     corrigeable est renvoyé une fois au professeur avec l’erreur exacte des tests)
 *   --url URL         serveur Ollama (défaut : http://127.0.0.1:11434)
 *
 * Rien n'est téléchargé. Aucun exercice ne ressemble aux missions d'évaluation (vérifié).
 */
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url);
let gen;
let lab;
try {
  gen = await import(new URL('../dist/developer/labGenerator.js', here).href);
  lab = await import(new URL('../dist/developer/labRunner.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    model: 'qwen3-coder:30b',
    count: 50,
    maxTries: null,
    dir: 'jarvis-data',
    timeoutS: 600,
    temperature: 0.7,
    ctx: 8192,
    think: false,
    repair: true,
    strength: true,
    url: 'http://127.0.0.1:11434',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`valeur manquante après ${arg}`);
      index += 1;
      return value;
    };
    if (arg === '--model') options.model = next();
    else if (arg === '--count') options.count = Math.max(1, Number(next()) || 1);
    else if (arg === '--max-tries') options.maxTries = Math.max(1, Number(next()) || 1);
    else if (arg === '--dir') options.dir = next();
    else if (arg === '--timeout') options.timeoutS = Math.max(30, Number(next()) || 600);
    else if (arg === '--temperature') options.temperature = Math.min(1.5, Math.max(0, Number(next())));
    else if (arg === '--ctx') options.ctx = Math.max(2048, Number(next()) || 8192);
    else if (arg === '--think') options.think = null;
    else if (arg === '--no-repair') options.repair = false;
    else if (arg === '--no-strength') options.strength = false;
    else if (arg === '--url') options.url = next().replace(/\/+$/, '');
    else if (arg === '--help' || arg === '-h') {
      console.log('Voir l’en-tête de packages/core/scripts/lab-generate.mjs pour les options.');
      process.exit(0);
    } else throw new Error(`option inconnue : ${arg}`);
  }
  options.maxTries ??= options.count * 4;
  return options;
}

async function readJsonl(path) {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
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
await mkdir(dir, { recursive: true });
const files = {
  exercises: join(dir, 'exercices.jsonl'),
  examples: join(dir, 'entrainement.jsonl'),
  rejects: join(dir, 'rejets.jsonl'),
};

const probe = await lab.probeLabModel(fetch, options.model, options.url);
if (!probe.ok) {
  console.error(`Professeur indisponible : ${probe.reason}. Installe-le avec « ollama pull ${options.model} ».`);
  process.exit(1);
}

const previous = await readJsonl(files.exercises);
// 5.0.59 : le thème de chaque exercice accompagne sa mission (le professeur voit ce qui a déjà été fait sur ce thème).
const accepted = previous
  .filter((row) => row.mission)
  .map((row) => ({ ...row.mission, ...(row.provenance?.seed?.theme ? { theme: row.provenance.seed.theme } : {}) }));
const teacher = gen.ollamaTeacher(options.model, {
  baseUrl: options.url,
  numCtx: options.ctx,
  temperature: options.temperature,
  think: options.think,
});
const salt = Math.floor(Date.now() / 1000) % 1_000_003;
const workParent = await mkdtemp(join(tmpdir(), 'jarvis-gen-'));
const reasons = new Map();
let fresh = 0;
let repairedCount = 0;
let tries = 0;
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('\nArrêt demandé : fin après l’exercice en cours (Ctrl+C encore pour couper net).');
});

console.log(
  `Générateur : professeur ${options.model} · ${options.count} exercice(s) visé(s), ${options.maxTries} essais au plus · ${accepted.length} déjà dans ${files.exercises}`,
);
const started = Date.now();
try {
  while (fresh < options.count && tries < options.maxTries && !stopping) {
    const seed = gen.seedFor(accepted.length + tries, salt);
    tries += 1;
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutS * 1000);
    let outcome;
    try {
      outcome = await gen.generateExercise({
        teacher,
        seed,
        accepted,
        workParent,
        signal: controller.signal,
        repair: options.repair,
        strength: options.strength,
      });
    } finally {
      clearTimeout(timer);
    }
    const seconds = ((Date.now() - t0) / 1000).toFixed(0);
    const label = `demandé : niv. ${seed.level} · ${seed.category} · ${seed.theme}`;
    if (outcome.ok) {
      fresh += 1;
      if (outcome.repaired) repairedCount += 1;
      accepted.push({ ...outcome.exercise.mission, theme: seed.theme });
      await appendFile(files.exercises, `${JSON.stringify(outcome.exercise)}\n`);
      await appendFile(files.examples, `${JSON.stringify(outcome.example)}\n`);
      const strength = outcome.exercise.strength?.total ? ` · tests : ${outcome.exercise.strength.killed}/${outcome.exercise.strength.total} erreurs vues` : '';
      console.log(`  ✔ ${String(tries).padStart(3)} · ${seconds} s · ${outcome.exercise.mission.id}${outcome.repaired ? ' (après correction)' : ''}${strength} (${label})`);
    } else {
      const reason = controller.signal.aborted ? `délai de ${options.timeoutS} s dépassé` : outcome.reason;
      const family = reason
        .replace(/^doublon de .*/, 'doublon')
        .replace(/^nom \S+ /, 'nom ')
        .replace(/ :.*$| \(.*\)$| dans .*$/, '')
        .trim();
      reasons.set(family, (reasons.get(family) ?? 0) + 1);
      const entry = {
        at: new Date().toISOString(),
        seed,
        reason,
        ...(outcome.detail ? { detail: outcome.detail } : {}),
        raw: outcome.raw.slice(0, 6000),
        ...(outcome.firstReason
          ? {
              firstReason: outcome.firstReason,
              ...(outcome.firstDetail ? { firstDetail: outcome.firstDetail } : {}),
              firstRaw: (outcome.firstRaw ?? '').slice(0, 6000),
            }
          : {}),
      };
      await appendFile(files.rejects, `${JSON.stringify(entry)}\n`);
      const before = outcome.firstReason && outcome.firstReason !== reason ? ` (d’abord : ${outcome.firstReason})` : '';
      console.log(`  ✘ ${String(tries).padStart(3)} · ${seconds} s · ${reason}${outcome.firstReason ? ' après correction' : ''}${before} (${label})`);
    }
  }
} finally {
  await rm(workParent, { recursive: true, force: true });
}

const minutes = ((Date.now() - started) / 60000).toFixed(0);
console.log('\n================ RÉSUMÉ ================');
console.log(`${fresh} exercice(s) accepté(s) sur ${tries} essai(s) (${tries ? Math.round((fresh / tries) * 100) : 0} %) en ${minutes} min, dont ${repairedCount} sauvé(s) par la seconde chance.`);
console.log(`Total dans le cahier : ${accepted.length} exercice(s) · exemples d’entraînement : ${files.examples}`);
if (reasons.size) {
  console.log('Rejets : ' + [...reasons].sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${reason} ×${count}`).join(' · '));
  console.log(`Détail des rejets : ${files.rejects}`);
}
