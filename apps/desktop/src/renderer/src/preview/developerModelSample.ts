import {
  CODE_MODEL_CATALOG,
  calibrate,
  checkHardware,
  expertsInRamChanges,
  expertsInRamInstructions,
  parseNvidiaSmi,
  predictModel,
  summarizeBench,
  type BenchResult,
  type BenchTaskResult,
  type HardwareFacts,
} from '@jarvis/core';
import type { CodeModelState } from '../../../shared/developerIpc';

/** Données d'aperçu (captures d'écran seulement) : le PC de thedexios, un étalonnage plausible, un banc d'exemple. */
const FACTS: HardwareFacts = {
  platform: 'win32',
  cpuModel: 'Intel(R) Core(TM) i7-9700KF CPU @ 3.60GHz',
  logicalCores: 8,
  totalRamBytes: 64 * 1024 ** 3,
  freeRamBytes: 47.2 * 1024 ** 3,
  gpus: parseNvidiaSmi('NVIDIA GeForce RTX 2060, 6144, 812, 5332, 581.29'),
  gpuProbe: 'ok',
  modelsDir: 'C:\\Users\\dex\\.ollama\\models',
  modelsDirFreeBytes: 412e9,
  ollama: {
    status: 'detected',
    version: '0.35.1',
    models: [
      {
        name: 'qwen2.5:3b',
        sizeBytes: 1.93e9,
        parameterSize: '3.1B',
        quantization: 'Q4_K_M',
        supportsTools: true,
      },
      {
        name: 'nomic-embed-text:latest',
        sizeBytes: 0.27e9,
        parameterSize: '137M',
        quantization: 'F16',
        supportsTools: false,
      },
    ],
  },
};

const CALIBRATION = calibrate(
  [
    {
      model: 'qwen2.5:3b',
      modelBytes: 1.93e9,
      mode: 'auto',
      sizeBytes: 2.6e9,
      sizeVramBytes: 2.6e9,
      outputTokens: 160,
      outputMs: 4_444,
      promptTokens: 62,
      promptMs: 118,
      loadMs: 1_840,
    },
    {
      model: 'qwen2.5:3b',
      modelBytes: 1.93e9,
      mode: 'cpu',
      sizeBytes: 2.6e9,
      sizeVramBytes: 0,
      outputTokens: 160,
      outputMs: 16_000,
      promptTokens: 62,
      promptMs: 905,
      loadMs: 2_150,
    },
  ],
  Date.now() - 60_000,
);

function task(
  id: string,
  label: string,
  kind: BenchTaskResult['kind'],
  ok: boolean | null,
  detail: string,
  tps: number,
): BenchTaskResult {
  return {
    id,
    label,
    kind,
    ok,
    detail,
    durationMs: 18_000,
    outputTokPerSec: tps,
    calls: kind === 'tool-call' ? 1 : 3,
  };
}

const BENCH_TASKS: BenchTaskResult[] = [
  task(
    'tool-read',
    'Appel d’outil : lire un fichier',
    'tool-call',
    true,
    'read_file sur version.ts',
    13.1,
  ),
  task(
    'tool-list',
    'Appel d’outil : lister les fichiers',
    'tool-call',
    true,
    'list_files appelé',
    13.4,
  ),
  task(
    'tool-find',
    'Appel d’outil : trouver une valeur',
    'tool-call',
    true,
    'readFile.ts lu, valeur 8000 donnée',
    12.8,
  ),
  task(
    'edit',
    'Modification exacte vérifiée par tsc',
    'edit',
    true,
    'import et entrée du tableau présents, tsc sans erreur',
    12.2,
  ),
  task(
    'fix',
    'Correction d’une erreur de compilation',
    'fix',
    true,
    'texte correct, tsc sans erreur',
    12.5,
  ),
];

const SAMPLE_BENCH: BenchResult = {
  model: 'qwen3.6:35b-a3b-coding',
  expertsInRam: true,
  startedAt: Date.now() - 140_000,
  finishedAt: Date.now() - 20_000,
  tasks: BENCH_TASKS,
  metrics: {
    outputTokPerSec: 12.7,
    promptTokPerSec: 186,
    loadMs: 9_400,
    sizeBytes: 25.4e9,
    sizeVramBytes: 4.1e9,
    gpuUsedMiB: 4_980,
    ramUsedBytes: 21.3e9,
  },
  summary: summarizeBench(BENCH_TASKS),
};

/** Scènes : developer-model (configuration proposée), developer-pull (carte de téléchargement), developer-bench (résultats). */
export function previewModelState(scene: string | null): CodeModelState {
  const models =
    scene === 'developer-bench'
      ? [
          ...FACTS.ollama.models,
          {
            name: 'qwen3.6:35b-a3b-coding',
            sizeBytes: 23e9,
            parameterSize: '35B',
            quantization: 'Q4_K_M',
            supportsTools: true,
          },
        ]
      : FACTS.ollama.models;
  const facts: HardwareFacts = { ...FACTS, ollama: { ...FACTS.ollama, models } };
  const validated = scene === 'developer-pull' || scene === 'developer-bench';
  const def = CODE_MODEL_CATALOG[0]!;
  return {
    hardware: { facts, report: checkHardware(facts), at: Date.now() - 90_000 },
    calibration: CALIBRATION,
    calibrationModel: 'qwen2.5:3b',
    candidates: CODE_MODEL_CATALOG.map((spec) => ({
      spec,
      installed: models.some((model) => model.name === spec.id),
      auto: predictModel(spec, facts, CALIBRATION, false),
      experts: spec.expertsInRam.supported ? predictModel(spec, facts, CALIBRATION, true) : null,
    })),
    experts: {
      changes: expertsInRamChanges(
        validated ? { LLAMA_ARG_CPU_MOE: '1', GGML_CUDA_NO_PINNED: '1' } : {},
      ),
      instructions: expertsInRamInstructions('win32'),
      confirmedAt: validated ? Date.now() - 50_000 : null,
    },
    validation: validated
      ? {
          modelId: def.id,
          expertsInRam: true,
          at: Date.now() - 40_000,
          prediction: predictModel(def, facts, CALIBRATION, true),
        }
      : null,
    pull:
      scene === 'developer-bench'
        ? { modelId: def.id, status: 'success', completed: 23e9, total: 23e9, done: true }
        : null,
    benches: scene === 'developer-bench' ? [SAMPLE_BENCH] : [],
  };
}
