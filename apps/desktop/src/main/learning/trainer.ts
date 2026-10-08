import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import {
  PERSONAL_OLLAMA_MODEL,
  examplesToJsonl,
  huggingFaceIdForOllamaTrainBase,
  type LocalLearningExample,
  type LocalLearningTrainPlan,
} from '@jarvis/core';
import type { LocalLearningStore } from './store.js';

export interface TrainOutcome {
  ok: boolean;
  error?: string;
  ollamaModel?: string;
}

function scriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'learning', 'jarvis-qlora-train.py');
  }
  return join(app.getAppPath(), 'scripts', 'jarvis-qlora-train.py');
}

async function runOllamaCreate(cwd: string, modelName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ollama', ['create', modelName, '-f', 'Modelfile'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let err = '';
    child.stderr?.on('data', (chunk) => {
      err += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `ollama create a échoué (${code})`));
    });
  });
}

/** Mode test / CI : adaptateur factice + pas d’appel Python. */
export async function dryRunTrain(
  store: LocalLearningStore,
  plan: LocalLearningTrainPlan,
  examples: LocalLearningExample[],
): Promise<TrainOutcome> {
  const work = store.workDir();
  await mkdir(work, { recursive: true });
  await mkdir(store.adapterDir(), { recursive: true });
  await writeFile(store.jsonlPath(), examplesToJsonl(examples), 'utf8');
  const adapter = join(work, 'adapter');
  await mkdir(adapter, { recursive: true });
  await writeFile(join(adapter, 'README.txt'), 'dry-run adapter', 'utf8');
  await writeFile(
    join(work, 'Modelfile'),
    `FROM ${plan.trainBaseModel}\n# dry-run\n`,
    'utf8',
  );
  return { ok: true, ollamaModel: PERSONAL_OLLAMA_MODEL };
}

export async function runQloraTrain(
  store: LocalLearningStore,
  plan: LocalLearningTrainPlan,
  examples: LocalLearningExample[],
  onLog?: (line: string) => void,
  pythonPath?: string,
): Promise<TrainOutcome> {
  if (process.env.JARVIS_LOCAL_LEARNING_DRY_RUN === '1') {
    return dryRunTrain(store, plan, examples);
  }

  const work = store.workDir();
  await mkdir(work, { recursive: true });
  await writeFile(store.jsonlPath(), examplesToJsonl(examples), 'utf8');
  const hf = huggingFaceIdForOllamaTrainBase(plan.trainBaseModel);

  const code = await new Promise<number>((resolve) => {
    const child = spawn(
      pythonPath ?? process.env.JARVIS_PYTHON ?? 'python',
      [
        scriptPath(),
        '--jsonl',
        store.jsonlPath(),
        '--out',
        work,
        '--hf-model',
        hf,
        '--ollama-base',
        plan.trainBaseModel,
        '--max-steps',
        String(Math.min(60, Math.max(12, examples.length * 3))),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    const onData = (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) onLog?.(line);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', () => resolve(127));
    child.on('close', (c) => resolve(c ?? 1));
  });

  if (code === 3) {
    return {
      ok: false,
      error: 'Bibliothèques Python d’apprentissage incomplètes après installation automatique.',
    };
  }
  if (code !== 0) {
    return { ok: false, error: `Entraînement QLoRA interrompu (code ${code}).` };
  }

  try {
    await runOllamaCreate(work, PERSONAL_OLLAMA_MODEL);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true, ollamaModel: PERSONAL_OLLAMA_MODEL };
}
