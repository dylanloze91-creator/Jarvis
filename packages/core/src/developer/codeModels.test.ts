import { describe, expect, it } from 'vitest';
import { CODE_MODEL_CATALOG, codeModelById, codeModelOptions } from './codeModels.js';
import { calibrate, predictModel, type CalibrationRun } from './estimate.js';
import { checkHardware, parseNvidiaSmi, type HardwareFacts } from './hardware.js';
import {
  EXPERTS_IN_RAM_VARIABLES,
  expertsInRamChanges,
  expertsInRamInstructions,
} from './ollamaServer.js';

const PC: HardwareFacts = {
  platform: 'win32',
  cpuModel: 'Intel(R) Core(TM) i7-9700KF CPU @ 3.60GHz',
  logicalCores: 8,
  totalRamBytes: 64 * 1024 ** 3,
  freeRamBytes: 48 * 1024 ** 3,
  gpus: parseNvidiaSmi('NVIDIA GeForce RTX 2060, 6144, 700, 5444, 581.29\n'),
  gpuProbe: 'ok',
  modelsDir: 'C:\\Users\\dex\\.ollama\\models',
  modelsDirFreeBytes: 400e9,
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
    ],
  },
};
const RUNS: CalibrationRun[] = [
  {
    model: 'qwen2.5:3b',
    modelBytes: 1.93e9,
    mode: 'auto',
    sizeBytes: 2.6e9,
    sizeVramBytes: 2.6e9,
    outputTokens: 160,
    outputMs: 4_444,
    promptTokens: 60,
    promptMs: 120,
    loadMs: 1_800,
  },
  {
    model: 'qwen2.5:3b',
    modelBytes: 1.93e9,
    mode: 'cpu',
    sizeBytes: 2.6e9,
    sizeVramBytes: 0,
    outputTokens: 160,
    outputMs: 16_000,
    promptTokens: 60,
    promptMs: 900,
    loadMs: 2_100,
  },
];

describe('catalogue des modèles de code (décision 4)', () => {
  it('quatre rôles : défaut, repli, rapide, qualité', () => {
    expect(CODE_MODEL_CATALOG.map((model) => [model.role, model.id])).toEqual([
      ['default', 'qwen3.6:35b-a3b-coding'],
      ['fallback', 'qwen3-coder:30b'],
      ['fast', 'qwen3.5:4b'],
      ['quality', 'qwen3.6:27b'],
    ]);
    for (const model of CODE_MODEL_CATALOG) {
      expect(model.quantization).toBe('Q4_K_M');
      expect(model.contextTokens).toBeGreaterThanOrEqual(16_384);
      expect(model.sources.length).toBeGreaterThan(0);
    }
  });

  it('réglages de requête : contexte fixe, réflexion coupée si le modèle la gère, experts en RAM seulement sur demande', () => {
    const def = codeModelById('qwen3.6:35b-a3b-coding')!;
    expect(codeModelOptions(def, false)).toEqual({
      numCtx: 32_768,
      keepAlive: '30m',
      think: false,
    });
    expect(codeModelOptions(def, true)).toEqual({
      numCtx: 32_768,
      keepAlive: '30m',
      think: false,
      numGpu: 99,
    });
    expect(codeModelOptions(codeModelById('qwen3-coder:30b')!, false)).toEqual({
      numCtx: 16_384,
      keepAlive: '30m',
    });
    expect(codeModelOptions(codeModelById('qwen3.5:4b')!, true)).toEqual({
      numCtx: 32_768,
      keepAlive: '30m',
      think: false,
      numGpu: 99,
    });
  });

  it('variables du serveur : ce qui changerait, commandes à lancer soi-même, retour arrière', () => {
    expect(EXPERTS_IN_RAM_VARIABLES.map((v) => `${v.name}=${v.value}`)).toEqual([
      'LLAMA_ARG_CPU_MOE=1',
      'GGML_CUDA_NO_PINNED=1',
    ]);
    const changes = expertsInRamChanges({ LLAMA_ARG_CPU_MOE: '1' });
    expect(changes.map((c) => [c.name, c.current, c.changes])).toEqual([
      ['LLAMA_ARG_CPU_MOE', '1', false],
      ['GGML_CUDA_NO_PINNED', null, true],
    ]);
    const win = expertsInRamInstructions('win32');
    expect(win.apply[0]).toBe(
      "[Environment]::SetEnvironmentVariable('LLAMA_ARG_CPU_MOE', '1', 'User')",
    );
    expect(win.undo[1]).toBe(
      "[Environment]::SetEnvironmentVariable('GGML_CUDA_NO_PINNED', $null, 'User')",
    );
    expect(win.restart).toMatch(/Quit Ollama/);
  });
});

describe('matériel', () => {
  it('lit nvidia-smi et vérifie RAM, carte, disque, Ollama', () => {
    expect(PC.gpus).toEqual([
      {
        name: 'NVIDIA GeForce RTX 2060',
        totalMiB: 6144,
        usedMiB: 700,
        freeMiB: 5444,
        driver: '581.29',
      },
    ]);
    const report = checkHardware(PC);
    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual(['ram', 'cpu', 'gpu', 'disk', 'ollama']);
  });

  it('sans nvidia-smi, sans Ollama, disque plein', () => {
    const report = checkHardware({
      ...PC,
      gpus: [],
      gpuProbe: 'absent',
      modelsDirFreeBytes: 2e9,
      ollama: { status: 'absent', version: null, models: [] },
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === 'gpu')?.detail).toMatch(/nvidia-smi introuvable/);
    expect(report.checks.find((c) => c.id === 'ollama')?.status).toBe('fail');
    expect(report.checks.find((c) => c.id === 'disk')?.status).toBe('fail');
  });
});

describe('estimations avant téléchargement', () => {
  const calibration = calibrate(RUNS, 0);

  it('l’étalonnage mesure le débit de la carte et de la RAM', () => {
    expect(Math.round(calibration.gpuBytesPerSec! / 1e9)).toBe(69);
    expect(Math.round(calibration.ramBytesPerSec! / 1e9)).toBe(19);
  });

  it('PC de thedexios : tout tient en RAM ; experts en RAM plus rapides ; rapide sur la carte ; qualité le plus lent', () => {
    const predict = (id: string, experts = false) =>
      predictModel(codeModelById(id)!, PC, calibration, experts);
    const def = predict('qwen3.6:35b-a3b-coding', true);
    const defAuto = predict('qwen3.6:35b-a3b-coding');
    expect(def.placement).toBe('experts-in-ram');
    expect(def.vramBytes).toBeLessThan(5e9);
    expect(def.tokPerSec.low).toBeGreaterThan(defAuto.tokPerSec.low);
    expect(defAuto.placement).toBe('split');
    expect(predict('qwen3.5:4b').placement).toBe('gpu');
    const quality = predict('qwen3.6:27b');
    expect(quality.tokPerSec.high).toBeLessThan(def.tokPerSec.low);
    for (const model of CODE_MODEL_CATALOG) {
      const p = predict(model.id, true);
      expect(p.fits).toBe(true);
      expect(p.diskOk).toBe(true);
      expect(p.basis).toBe('étalonnée');
      expect(p.tokPerSec.low).toBeLessThan(p.tokPerSec.high);
    }
  });

  it('sans étalonnage : débits par défaut, signalé ; sans carte : processeur ; 16 Go de RAM : le défaut ne tient pas', () => {
    expect(predictModel(CODE_MODEL_CATALOG[0]!, PC, null, true).notes.join(' ')).toMatch(
      /Pas d’étalonnage/,
    );
    expect(
      predictModel(CODE_MODEL_CATALOG[0]!, { ...PC, gpus: [] }, calibration, true).placement,
    ).toBe('ram');
    expect(
      predictModel(
        CODE_MODEL_CATALOG[0]!,
        { ...PC, totalRamBytes: 16 * 1024 ** 3 },
        calibration,
        true,
      ).fits,
    ).toBe(false);
  });
});
