#!/usr/bin/env node
/**
 * Banc du laboratoire (5.0.54) : les 9 missions de `lab.ts`, sur un ou plusieurs
 * modèles Ollama déjà installés, en plusieurs passages, avec la cause de chaque échec.
 *
 * Depuis la racine du dépôt :
 *   npm run lab --workspace @jarvis/core -- --model qwen2.5:3b,qwen2.5-coder:7b --runs 3
 *
 * Options :
 *   --model a,b,c     modèles à comparer (défaut : qwen2.5:1.5b)
 *   --runs N          passages par modèle (défaut : 3)
 *   --attempts N      essais par mission, avec le retour des tests (défaut : 2)
 *   --timeout S       secondes par essai (défaut : 90)
 *   --ctx N           num_ctx (défaut : 4096, celui du laboratoire)
 *   --think           laisse la réflexion des modèles Qwen3 (défaut : coupée)
 *   --no-recover      comportement 5.0.53 : un appel d'outil écrit en texte arrête l'essai
 *   --compare-recover lance chaque modèle deux fois : sans puis avec la récupération
 *   --set JEU         reference (9 missions, défaut), eval (29), train (104, mesure étendue), all
 *   (5.0.56) --collect est retiré : les missions du catalogue servent à mesurer, pas à entraîner.
 *   Les exemples d’entraînement viennent de « npm run lab:generate ».
 *   --url URL         serveur Ollama (défaut : http://127.0.0.1:11434)
 *   --out FICHIER     rapport JSON (défaut : lab-results-<date>.json dans le dossier courant)
 *
 * Rien n'est téléchargé : un modèle absent est signalé et sauté.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url);
let lab;
let catalog;
try {
  lab = await import(new URL('../dist/developer/labRunner.js', here).href);
  catalog = await import(new URL('../dist/developer/labCatalog.js', here).href);
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}
const { runLabBatch, ollamaLabModel, probeLabModel } = lab;
const { catalogMissions } = catalog;

function parseArgs(argv) {
  const options = {
    models: ['qwen2.5:1.5b'],
    runs: 3,
    attempts: 2,
    timeoutS: 90,
    ctx: 4096,
    think: false,
    recoverModes: [true],
    url: 'http://127.0.0.1:11434',
    out: null,
    set: 'reference',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`valeur manquante après ${arg}`);
      index += 1;
      return value;
    };
    if (arg === '--model' || arg === '--models') {
      options.models = next()
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    } else if (arg === '--runs') options.runs = Math.max(1, Number(next()) || 1);
    else if (arg === '--attempts') options.attempts = Math.max(1, Number(next()) || 1);
    else if (arg === '--timeout') options.timeoutS = Math.max(5, Number(next()) || 90);
    else if (arg === '--ctx') options.ctx = Math.max(1024, Number(next()) || 4096);
    else if (arg === '--think') options.think = null;
    else if (arg === '--no-recover') options.recoverModes = [false];
    else if (arg === '--compare-recover') options.recoverModes = [false, true];
    else if (arg === '--url') options.url = next().replace(/\/+$/, '');
    else if (arg === '--out') options.out = next();
    else if (arg === '--set') {
      options.set = next();
      if (!['reference', 'eval', 'train', 'all'].includes(options.set)) throw new Error(`jeu inconnu : ${options.set}`);
    } else if (arg === '--collect') {
      throw new Error(
        '--collect est retiré (5.0.56) : les missions du catalogue servent à mesurer, pas à entraîner. Les exemples d’entraînement viennent de « npm run lab:generate --workspace @jarvis/core ».',
      );
    }
    else if (arg === '--help' || arg === '-h') {
      console.log('Voir l’en-tête de packages/core/scripts/lab-bench.mjs pour les options.');
      process.exit(0);
    } else throw new Error(`option inconnue : ${arg}`);
  }
  return options;
}


/** Charge le modèle une fois (hors chronomètre des missions) et lit son placement carte/RAM. */
async function warmUp(url, model, ctx) {
  const started = Date.now();
  try {
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'ok', stream: false, keep_alive: '10m', options: { num_ctx: ctx, num_predict: 1 } }),
      signal: AbortSignal.timeout(600_000),
    });
    if (!response.ok) return { loadS: null, gpuShare: null, sizeGb: null, error: `HTTP ${response.status}` };
  } catch (error) {
    return { loadS: null, gpuShare: null, sizeGb: null, error: String(error?.message ?? error) };
  }
  const loadS = (Date.now() - started) / 1000;
  try {
    const ps = await (await fetch(`${url}/api/ps`, { signal: AbortSignal.timeout(5_000) })).json();
    const entry = (ps.models ?? []).find((item) => item.name === model || item.model === model);
    if (!entry?.size) return { loadS, gpuShare: null, sizeGb: null, error: null };
    return { loadS, gpuShare: (entry.size_vram ?? 0) / entry.size, sizeGb: entry.size / 1e9, error: null };
  } catch {
    return { loadS, gpuShare: null, sizeGb: null, error: null };
  }
}

/** Cause d'un échec, lisible : ce qu'il faut corriger n'est pas le même selon la cause. */
function diagnose(result) {
  if (result.excluded) return `écartée : ${result.excludeReason}`;
  const last = result.attempts.at(-1);
  if (!last) return 'aucun essai';
  if (last.exitCode === 0 && last.failed === 0 && (last.testsRan ?? 0) > 0) return 'réussie';
  if (last.modelError) {
    if (/délai/.test(last.modelError)) return 'délai dépassé';
    if (/texte brut|tool_call|appel d.outil/i.test(last.modelError)) return 'appel d’outil illisible';
    return `erreur du modèle : ${last.modelError.slice(0, 80)}`;
  }
  if (!result.attempts.some((attempt) => attempt.wrote)) return 'n’a rien écrit';
  if (!last.wrote) return 'code faux, répété sans changement';
  return 'code faux (tests rouges)';
}

function pct(part, total) {
  return total ? `${Math.round((part / total) * 100)} %` : '—';
}

function pad(text, width) {
  const value = String(text);
  return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length);
}

async function benchModel(options, model, recover) {
  const label = `${model}${options.recoverModes.length > 1 ? (recover ? ' [récupération]' : ' [5.0.53]') : ''}`;
  console.log(`\n=== ${label} ===`);
  const probe = await probeLabModel(fetch, model, options.url);
  if (!probe.ok) {
    console.log(`  sauté : ${probe.reason}. Installe-le avec « ollama pull ${model} ».`);
    return { model, label, recover, skipped: probe.reason, runs: [] };
  }
  const warm = await warmUp(options.url, model, options.ctx);
  if (warm.error) console.log(`  chargement : échec (${warm.error})`);
  else {
    const gpu = warm.gpuShare === null ? '?' : `${Math.round(warm.gpuShare * 100)} % sur la carte`;
    const size = warm.sizeGb === null ? '' : `, ${warm.sizeGb.toFixed(1)} Go en mémoire`;
    console.log(`  chargé en ${warm.loadS.toFixed(1)} s (${gpu}${size})`);
  }
  const model$ = ollamaLabModel(probe.digest, undefined, model, {
    recoverToolCalls: recover,
    numCtx: options.ctx,
    think: options.think,
    baseUrl: options.url,
  });
  const runs = [];
  for (let run = 1; run <= options.runs; run += 1) {
    const workParent = await mkdtemp(join(tmpdir(), 'jarvis-lab-'));
    const missions = [];
    const started = Date.now();
    let missionStart = Date.now();
    try {
      await runLabBatch({
        model: model$,
        workParent,
        missions: catalogMissions(options.set),
        maxAttempts: options.attempts,
        timeoutMs: options.timeoutS * 1000,
        onResult: (mission, result) => {
          const seconds = (Date.now() - missionStart) / 1000;
          missionStart = Date.now();
          const verdict = diagnose(result);
          const recovered = result.attempts.reduce((sum, attempt) => sum + (attempt.recoveredCalls ?? 0), 0);
          missions.push({
            id: mission.id,
            level: mission.level,
            excluded: result.excluded,
            passed: verdict === 'réussie',
            firstTry: result.attempts.length === 1 && verdict === 'réussie',
            verdict,
            attempts: result.attempts.length,
            modelCalls: result.modelCalls,
            recoveredCalls: recovered,
            seconds,
            attemptDetail: result.attempts,
          });
          process.stdout.write(`  passage ${run} · ${pad(mission.id, 22)} ${verdict}${recovered ? ` (${recovered} appel(s) relu(s) dans le texte)` : ''}\n`);
        },
      });
    } finally {
      await rm(workParent, { recursive: true, force: true });
    }
    const counted = missions.filter((mission) => !mission.excluded);
    const passed = counted.filter((mission) => mission.passed).length;
    console.log(`  → passage ${run} : ${passed}/${counted.length} en ${((Date.now() - started) / 1000).toFixed(0)} s`);
    runs.push({ run, passed, total: counted.length, seconds: (Date.now() - started) / 1000, missions });
  }
  return { model, label, recover, digest: probe.digest, warm, runs };
}

function summarize(results) {
  console.log('\n================ RÉSUMÉ ================');
  for (const result of results) {
    if (result.skipped) {
      console.log(`${result.label} : sauté (${result.skipped})`);
      continue;
    }
    const scores = result.runs.map((run) => run.passed);
    const total = result.runs.reduce((sum, run) => sum + run.total, 0);
    const passed = scores.reduce((sum, value) => sum + value, 0);
    const perRun = result.runs[0]?.total ?? 0;
    const avgS = result.runs.reduce((sum, run) => sum + run.seconds, 0) / Math.max(1, result.runs.length);
    console.log(
      `\n${result.label} : ${passed}/${total} (${pct(passed, total)}) · par passage ${scores.join(', ')} sur ${perRun} · ${avgS.toFixed(0)} s par passage`,
    );
    const causes = new Map();
    const byMission = new Map();
    for (const run of result.runs) {
      for (const mission of run.missions) {
        if (mission.excluded) continue;
        if (!mission.passed) causes.set(mission.verdict, (causes.get(mission.verdict) ?? 0) + 1);
        const entry = byMission.get(mission.id) ?? { passed: 0, total: 0 };
        entry.total += 1;
        if (mission.passed) entry.passed += 1;
        byMission.set(mission.id, entry);
      }
    }
    console.log('  par mission : ' + [...byMission].map(([id, entry]) => `${id} ${entry.passed}/${entry.total}`).join(' · '));
    if (causes.size) {
      console.log('  causes des échecs : ' + [...causes].sort((a, b) => b[1] - a[1]).map(([cause, count]) => `${cause} ×${count}`).join(' · '));
    }
  }
  console.log('\nLecture : un écart de 1 ou 2 missions entre deux passages est du bruit. Compare des totaux sur 3 passages ou plus.');
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`Option refusée : ${error.message}`);
  process.exit(1);
}
console.log(
  `Banc du laboratoire (${options.set}, ${catalogMissions(options.set).length} missions) : ${options.models.join(', ')} · ${options.runs} passage(s) · ${options.attempts} essai(s) par mission · ${options.timeoutS} s par essai · num_ctx ${options.ctx}`,
);
const results = [];
for (const model of options.models) {
  for (const recover of options.recoverModes) results.push(await benchModel(options, model, recover));
}
summarize(results);
const out = resolve(options.out ?? `lab-results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(out, `${JSON.stringify({ at: new Date().toISOString(), options, results }, null, 2)}\n`);
console.log(`\nRapport complet : ${out}`);
