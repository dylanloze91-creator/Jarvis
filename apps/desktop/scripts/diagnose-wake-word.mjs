#!/usr/bin/env node
/**
 * Utilitaire de diagnostic réutilisable : rejoue la chaîne de détection du
 * mot de réveil (garde d'énergie → Whisper → comparaison texte tolérante)
 * sur un fichier audio existant, pour vérifier une calibration réelle sans
 * avoir besoin d'un micro branché sur cette machine. Accepte n'importe quel
 * format lu par ffmpeg (WAV, MP3, …) : le fichier est transcodé en WAV
 * 16 kHz mono avant analyse.
 *
 * `@huggingface/transformers` tourne aussi bien sous Node (ce script, backend
 * ONNX Runtime natif) que dans le renderer Electron (WebAssembly/WebGPU,
 * voir `apps/desktop/src/renderer/src/voice/whisper/pipelineLoader.ts`) :
 * même algorithme, mêmes garanties, seul le backend d'exécution change.
 *
 * Usage :
 *   node apps/desktop/scripts/diagnose-wake-word.mjs <fichier audio> [motDeReveil]
 *
 * Exporte aussi `diagnoseWakeWordFile()`, réutilisable depuis un autre
 * script Node — par exemple pour vérifier un enregistrement envoyé par un
 * utilisateur sans repasser par l'interface.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from '@huggingface/transformers';
import {
  computeRms,
  concatFloat32,
  decodeWav,
  evaluateWakeWordWindow,
  peakEnergy,
  WHISPER_WAKE_WORD_LANGUAGE,
  WHISPER_WAKE_WORD_MODEL,
} from '@jarvis/core';

/**
 * Constantes copiées des modules réels qu'elles simulent, pour que
 * `simulateVoiceSessionFile` rejoue exactement le même comportement que
 * l'application — pas une approximation. Toute modification de ces valeurs
 * dans le code réel doit être répercutée ici :
 * - `FRAME_SIZE_SAMPLES` : `apps/desktop/src/renderer/src/voice/audioCapture.ts`.
 * - `SILENCE_RMS_THRESHOLD`/`SILENCE_DURATION_MS` : `apps/desktop/src/renderer/src/voice/useVoice.ts`.
 * - `WAKE_WINDOW_MS`/`WAKE_MIN_WINDOW_FILL_RATIO`/`WAKE_MIN_ANALYSIS_INTERVAL_MS`/`WAKE_COOLDOWN_MS` :
 *   `apps/desktop/src/renderer/src/voice/whisperWakeWordEngine.ts`.
 */
const FRAME_SIZE_SAMPLES = 4096;
const SILENCE_RMS_THRESHOLD = 0.012;
const SILENCE_DURATION_MS = 900;
const WAKE_WINDOW_MS = 1600;
const WAKE_MIN_WINDOW_FILL_RATIO = 0.6;
const WAKE_MIN_ANALYSIS_INTERVAL_MS = 700;
/** Voir `apps/desktop/src/renderer/src/voice/localWhisperStt.ts` (`MIN_UTTERANCE_PEAK_ENERGY`). */
const COMMAND_MIN_PEAK_ENERGY = 0.02;

/** Transcode n'importe quel format audio lu par ffmpeg en WAV 16 kHz mono, dans un dossier temporaire. */
async function transcodeToWav16kMono(inputPath) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jarvis-diagnose-'));
  const outputPath = path.join(dir, 'audio.wav');
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 'wav', outputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg a échoué (code ${code}) : ${stderr.slice(-500)}`));
    });
  });
  return { dir, outputPath };
}

/** Découpe un signal en fenêtres glissantes (mêmes paramètres que `WhisperWakeWordEngine` par défaut). */
function sliceWindows(samples, sampleRate, windowMs, hopMs) {
  const windowLength = Math.round((windowMs / 1000) * sampleRate);
  const hopLength = Math.round((hopMs / 1000) * sampleRate);
  if (samples.length <= windowLength) {
    return [{ startMs: 0, endMs: Math.round((samples.length / sampleRate) * 1000), samples }];
  }
  const windows = [];
  for (let start = 0; start < samples.length; start += hopLength) {
    const end = Math.min(samples.length, start + windowLength);
    windows.push({
      startMs: Math.round((start / sampleRate) * 1000),
      endMs: Math.round((end / sampleRate) * 1000),
      samples: samples.subarray(start, end),
    });
    if (end >= samples.length) break;
  }
  return windows;
}

/**
 * Rejoue la chaîne de détection sur un fichier entier, fenêtre par fenêtre,
 * et rapporte pour chacune si elle a été analysée (garde d'énergie), ce qui
 * a été transcrit, et si le mot de réveil a été reconnu.
 *
 * Si `transcribeCommandAfter` est vrai et qu'une détection a lieu, transcrit
 * en plus l'audio situé après la fin de la fenêtre détectée avec
 * `commandModelRepo` (le modèle de dictée, potentiellement plus gros que
 * celui du mot de réveil) — pour vérifier que le mot de réveil lui-même
 * n'apparaît pas dans la commande transmise à l'agent, exactement comme le
 * fait l'application réelle (elle ne pousse jamais l'audio du mot de réveil
 * au moteur de dictée, voir `useVoice.ts`).
 */
export async function diagnoseWakeWordFile(filePath, options = {}) {
  const {
    word = 'jarvis',
    variants = [],
    windowMs = 1600,
    hopMs = 800,
    minPeakEnergy = 0.015,
    modelRepo = WHISPER_WAKE_WORD_MODEL.repo,
    wakeWordLanguage = WHISPER_WAKE_WORD_LANGUAGE,
    device = 'cpu',
    transcribeCommandAfter = false,
    commandModelRepo = 'Xenova/whisper-base',
    commandLanguage = 'french',
  } = options;

  const { dir, outputPath } = await transcodeToWav16kMono(filePath);
  try {
    const bytes = await readFile(outputPath);
    const { samples, sampleRate } = decodeWav(new Uint8Array(bytes));
    const transcriber = await pipeline('automatic-speech-recognition', modelRepo, { device, dtype: 'q8' });

    const transcribe = async (frame) => {
      const output = await transcriber(frame, { language: wakeWordLanguage, task: 'transcribe' });
      const first = Array.isArray(output) ? output[0] : output;
      return first?.text?.trim() ?? '';
    };

    const windows = sliceWindows(samples, sampleRate, windowMs, hopMs);
    const results = [];
    let firstMatch = null;
    for (const window of windows) {
      const result = await evaluateWakeWordWindow(window.samples, sampleRate, transcribe, { word, variants }, {
        minPeakEnergy,
      });
      const entry = { startMs: window.startMs, endMs: window.endMs, ...result };
      results.push(entry);
      if (result.matched && !firstMatch) firstMatch = entry;
    }

    const report = {
      file: filePath,
      durationMs: Math.round((samples.length / sampleRate) * 1000),
      wordDetected: results.some((r) => r.matched),
      firstMatchAtMs: firstMatch?.endMs ?? null,
      windows: results,
      command: null,
    };

    if (transcribeCommandAfter && firstMatch) {
      const startSample = Math.round((firstMatch.endMs / 1000) * sampleRate);
      const remainder = samples.subarray(startSample);
      if (remainder.length > 0 && peakEnergy(remainder) >= COMMAND_MIN_PEAK_ENERGY) {
        const commandTranscriber = await pipeline('automatic-speech-recognition', commandModelRepo, {
          device,
          dtype: 'q8',
        });
        const output = await commandTranscriber(remainder, {
          language: commandLanguage,
          task: 'transcribe',
        });
        const first = Array.isArray(output) ? output[0] : output;
        report.command = {
          modelRepo: commandModelRepo,
          afterMs: firstMatch.endMs,
          transcript: first?.text?.trim() ?? '',
        };
      } else if (remainder.length > 0) {
        report.command = { modelRepo: null, afterMs: firstMatch.endMs, transcript: '', skippedReason: 'énoncé quasi silencieux' };
      }
    }

    return report;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Rejoue le fichier trame par trame (4096 échantillons, comme le
 * `ScriptProcessorNode` réel), en simulant exactement l'état de
 * l'application : le mot de réveil analysé sur une fenêtre glissante
 * pendant l'état « sleeping », puis, une fois détecté, le passage à
 * « listening » où les trames vont au moteur de dictée jusqu'à ce que le
 * silence soit détecté pendant plus de `SILENCE_DURATION_MS` — exactement
 * la logique de `useVoice.ts`. Contrairement à `diagnoseWakeWordFile`
 * (fenêtres fixes, indépendantes), cette fonction ne transcrit la commande
 * qu'à partir de l'instant réel de détection, jamais avant : c'est la
 * preuve que le mot de réveil ne peut structurellement pas se retrouver
 * dans le texte envoyé au modèle de dictée, et que la fin de phrase est
 * bien détectée par silence, pas par une durée fixe arbitraire.
 */
export async function simulateVoiceSessionFile(filePath, options = {}) {
  const {
    word = 'jarvis',
    variants = [],
    wakeModelRepo = WHISPER_WAKE_WORD_MODEL.repo,
    wakeLanguage = WHISPER_WAKE_WORD_LANGUAGE,
    commandModelRepo = 'Xenova/whisper-base',
    commandLanguage = 'french',
    minPeakEnergy = 0.015,
    device = 'cpu',
  } = options;

  const { dir, outputPath } = await transcodeToWav16kMono(filePath);
  try {
    const bytes = await readFile(outputPath);
    const { samples, sampleRate } = decodeWav(new Uint8Array(bytes));
    const wakeTranscriber = await pipeline('automatic-speech-recognition', wakeModelRepo, { device, dtype: 'q8' });
    const transcribeWake = async (frame) => {
      const output = await wakeTranscriber(frame, { language: wakeLanguage, task: 'transcribe' });
      const first = Array.isArray(output) ? output[0] : output;
      return first?.text?.trim() ?? '';
    };

    const frames = [];
    for (let start = 0; start < samples.length; start += FRAME_SIZE_SAMPLES) {
      frames.push(samples.subarray(start, Math.min(samples.length, start + FRAME_SIZE_SAMPLES)));
    }

    let simulatedNowMs = 0;
    let state = 'sleeping';
    let wakeBuffer = [];
    let wakeBufferedMs = 0;
    let lastAnalysisAt = -Infinity;
    let wakeDetectedAtMs = null;
    let wakeTranscript = null;
    let silenceSinceMs = null;
    const commandFrames = [];
    let commandStartMs = null;
    let commandEndMs = null;
    let commandEndReason = null;

    for (const frame of frames) {
      const frameDurationMs = (frame.length / sampleRate) * 1000;

      if (state === 'sleeping') {
        wakeBuffer.push(frame);
        wakeBufferedMs += frameDurationMs;
        while (wakeBufferedMs > WAKE_WINDOW_MS && wakeBuffer.length > 1) {
          const removed = wakeBuffer.shift();
          wakeBufferedMs -= (removed.length / sampleRate) * 1000;
        }

        const canAnalyze =
          simulatedNowMs - lastAnalysisAt >= WAKE_MIN_ANALYSIS_INTERVAL_MS &&
          wakeBufferedMs >= WAKE_WINDOW_MS * WAKE_MIN_WINDOW_FILL_RATIO;

        if (canAnalyze) {
          lastAnalysisAt = simulatedNowMs;
          const snapshot = concatFloat32(wakeBuffer);
          // Simulation séquentielle volontaire : un seul appel Whisper en vol, comme en production.
          const result = await evaluateWakeWordWindow(snapshot, sampleRate, transcribeWake, { word, variants }, {
            minPeakEnergy,
          });
          if (result.matched) {
            wakeDetectedAtMs = simulatedNowMs + frameDurationMs;
            wakeTranscript = result.transcript;
            state = 'listening';
            commandStartMs = wakeDetectedAtMs;
            wakeBuffer = [];
            wakeBufferedMs = 0;
          }
        }
      } else if (state === 'listening') {
        commandFrames.push(frame);
        const rms = computeRms(frame);
        if (rms < SILENCE_RMS_THRESHOLD) {
          if (silenceSinceMs === null) silenceSinceMs = simulatedNowMs;
          else if (simulatedNowMs - silenceSinceMs > SILENCE_DURATION_MS) {
            commandEndMs = simulatedNowMs;
            commandEndReason = 'silence';
            break;
          }
        } else {
          silenceSinceMs = null;
        }
      }

      simulatedNowMs += frameDurationMs;
    }

    if (state === 'listening' && commandEndReason === null) commandEndReason = 'fin-de-fichier';

    let command = null;
    if (commandFrames.length > 0) {
      const commandPcm = concatFloat32(commandFrames);
      const baseResult = {
        startMs: Math.round(commandStartMs),
        endMs: commandEndMs !== null ? Math.round(commandEndMs) : null,
        endReason: commandEndReason,
      };
      if (peakEnergy(commandPcm) < COMMAND_MIN_PEAK_ENERGY) {
        // Reproduit la garde de `LocalWhisperSttProvider` : énoncé quasi silencieux, pas de transcription tentée.
        command = { ...baseResult, modelRepo: null, transcript: '', skippedReason: 'énoncé quasi silencieux' };
      } else {
        const commandTranscriber = await pipeline('automatic-speech-recognition', commandModelRepo, {
          device,
          dtype: 'q8',
        });
        const output = await commandTranscriber(commandPcm, { language: commandLanguage, task: 'transcribe' });
        const first = Array.isArray(output) ? output[0] : output;
        command = { ...baseResult, modelRepo: commandModelRepo, transcript: first?.text?.trim() ?? '' };
      }
    }

    return {
      file: filePath,
      wakeWordDetected: wakeDetectedAtMs !== null,
      wakeWordDetectedAtMs: wakeDetectedAtMs !== null ? Math.round(wakeDetectedAtMs) : null,
      wakeWordTranscript: wakeTranscript,
      command,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function formatWindow(window) {
  if (!window.analyzed) return 'ignorée (silence, garde d’énergie — aucun appel Whisper)';
  const suffix = window.matched ? '  ← MOT DE RÉVEIL DÉTECTÉ' : '';
  return `transcrit : "${window.transcript}"${suffix}`;
}

async function main() {
  const [, , filePath, wordArg] = process.argv;
  if (!filePath) {
    console.error('Usage : node diagnose-wake-word.mjs <fichier audio> [mot-de-réveil]');
    process.exitCode = 1;
    return;
  }
  const word = wordArg ?? 'jarvis';
  console.log(`Analyse de ${filePath} (mot de réveil : « ${word} »)…\n`);

  const result = await diagnoseWakeWordFile(filePath, { word, transcribeCommandAfter: true });

  for (const window of result.windows) {
    console.log(`  [${String(window.startMs).padStart(6)} ms] ${formatWindow(window)}`);
  }

  console.log('');
  console.log(
    result.wordDetected
      ? `✅ Mot de réveil détecté (fin de la fenêtre de détection à ${result.firstMatchAtMs} ms).`
      : '❌ Mot de réveil NON détecté sur ce fichier.',
  );
  if (result.command) {
    if (result.command.skippedReason) {
      console.log(`\nCommande après le mot de réveil : transcription non tentée (${result.command.skippedReason}).`);
    } else {
      console.log(`\nCommande transcrite après le mot de réveil (modèle ${result.command.modelRepo}) :`);
      console.log(`  "${result.command.transcript}"`);
    }
  }

  console.log('\n--- Simulation fidèle (trame par trame, coupure par silence réelle) ---\n');
  const simulation = await simulateVoiceSessionFile(filePath, { word });
  console.log(
    simulation.wakeWordDetected
      ? `✅ Mot de réveil détecté à ${simulation.wakeWordDetectedAtMs} ms (transcrit : "${simulation.wakeWordTranscript}").`
      : '❌ Mot de réveil NON détecté par la simulation.',
  );
  if (simulation.command) {
    console.log(
      `Commande capturée de ${simulation.command.startMs} ms à ${simulation.command.endMs ?? '(fin du fichier)'} ms (fin par ${simulation.command.endReason}) :`,
    );
    if (simulation.command.skippedReason) {
      console.log(`  (transcription non tentée : ${simulation.command.skippedReason})`);
    } else {
      console.log(`  "${simulation.command.transcript}"`);
    }
  } else {
    console.log('Aucune commande capturée après le mot de réveil.');
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
