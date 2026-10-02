import type { CodeModelSpec } from './codeModels.js';
import { mainGpu, type HardwareFacts } from './hardware.js';

/**
 * Estimations avant tout téléchargement. Écrire un jeton relit les poids
 * utiles : la vitesse dépend surtout du débit mémoire (carte et RAM). On le
 * mesure sur un modèle déjà installé (étalonnage), puis on l'applique aux
 * candidats. Ce sont des estimations : seul le banc de code, après
 * téléchargement, donne la vraie vitesse.
 */
export interface CalibrationRun {
  model: string;
  /** Taille du fichier du modèle (≈ poids relus à chaque jeton pour un modèle dense). */
  modelBytes: number;
  mode: 'auto' | 'cpu';
  sizeBytes: number;
  sizeVramBytes: number;
  outputTokens: number;
  outputMs: number;
  promptTokens: number;
  promptMs: number;
  loadMs: number;
}

export interface Calibration {
  runs: CalibrationRun[];
  gpuBytesPerSec: number | null;
  ramBytesPerSec: number | null;
  at: number;
}

export function tokensPerSecond(tokens: number, ms: number): number {
  return ms > 0 ? tokens / (ms / 1000) : 0;
}

export function calibrate(runs: CalibrationRun[], at: number): Calibration {
  let gpu: number | null = null;
  let ram: number | null = null;
  for (const run of runs) {
    const tps = tokensPerSecond(run.outputTokens, run.outputMs);
    if (tps <= 0 || run.modelBytes <= 0) continue;
    const onGpu = run.sizeBytes > 0 ? run.sizeVramBytes / run.sizeBytes : 0;
    const bandwidth = tps * run.modelBytes;
    if (run.mode === 'cpu' || onGpu < 0.05) ram = Math.max(ram ?? 0, bandwidth);
    else if (onGpu >= 0.95) gpu = Math.max(gpu ?? 0, bandwidth);
  }
  return { runs, gpuBytesPerSec: gpu, ramBytesPerSec: ram, at };
}

const GPU_BANDWIDTH: Array<[RegExp, number]> = [
  [/rtx\s*2060\s*super/i, 448e9],
  [/rtx\s*2060/i, 336e9],
  [/rtx\s*2070/i, 448e9],
  [/rtx\s*2080/i, 448e9],
  [/rtx\s*3060/i, 360e9],
  [/rtx\s*3070/i, 448e9],
  [/rtx\s*3080/i, 760e9],
  [/rtx\s*4060/i, 272e9],
  [/rtx\s*4070/i, 504e9],
  [/rtx\s*4080/i, 717e9],
  [/rtx\s*4090/i, 1008e9],
  [/gtx\s*1060/i, 192e9],
  [/gtx\s*1660/i, 192e9],
];
/** Part du débit théorique réellement atteinte en génération (estimation prudente). */
const GPU_EFFICIENCY = 0.55;
const DEFAULT_RAM_BYTES_PER_SEC = 25e9;
/** Pertes du routage des experts et des échanges carte ↔ RAM (estimation). */
const MOE_FACTOR = 0.7;
const SYSTEM_VRAM_RESERVE = 0.8e9;
const SYSTEM_RAM_RESERVE = 10e9;

export interface Prediction {
  modelId: string;
  expertsInRam: boolean;
  placement: 'gpu' | 'split' | 'experts-in-ram' | 'ram';
  fits: boolean;
  vramBytes: number;
  ramBytes: number;
  diskOk: boolean | null;
  tokPerSec: { low: number; high: number };
  publishedTokPerSec: [number, number];
  basis: 'étalonnée' | 'par défaut';
  notes: string[];
}

export function bandwidths(
  hardware: HardwareFacts,
  calibration: Calibration | null,
): { gpu: number; ram: number; basis: Prediction['basis'] } {
  const gpu = mainGpu(hardware);
  const table = gpu
    ? (GPU_BANDWIDTH.find(([pattern]) => pattern.test(gpu.name))?.[1] ?? 250e9) * GPU_EFFICIENCY
    : 0;
  return {
    gpu: calibration?.gpuBytesPerSec ?? table,
    ram: calibration?.ramBytesPerSec ?? DEFAULT_RAM_BYTES_PER_SEC,
    basis: calibration?.gpuBytesPerSec || calibration?.ramBytesPerSec ? 'étalonnée' : 'par défaut',
  };
}

export function predictModel(
  spec: CodeModelSpec,
  hardware: HardwareFacts,
  calibration: Calibration | null,
  expertsInRam: boolean,
): Prediction {
  const notes: string[] = [];
  const bw = bandwidths(hardware, calibration);
  const gpu = mainGpu(hardware);
  const totalVram = gpu ? gpu.totalMiB * 1024 * 1024 : 0;
  const otherVram = gpu
    ? Math.min(Math.max(gpu.usedMiB * 1024 * 1024, 0), 1.2e9) || SYSTEM_VRAM_RESERVE
    : 0;
  const kv = spec.kvBytesPerToken * spec.contextTokens;
  const overhead = gpu ? 0.5e9 + spec.contextTokens * 8_000 : 0;
  const usable = Math.max(0, totalVram - otherVram);
  const weights = spec.downloadBytes;
  const useExperts = expertsInRam && spec.expertsInRam.supported && spec.architecture === 'moe';
  let placement: Prediction['placement'];
  let vram: number;
  let speed: number;

  const split = (perTokenBytes: number, onGpuFraction: number): number =>
    1 /
    ((onGpuFraction * perTokenBytes) / Math.max(bw.gpu, 1) +
      ((1 - onGpuFraction) * perTokenBytes) / bw.ram);

  if (!gpu) {
    placement = 'ram';
    vram = 0;
    const perToken =
      spec.architecture === 'moe' ? spec.sharedBytes + spec.expertBytesPerToken : weights;
    speed = (bw.ram / perToken) * (spec.architecture === 'moe' ? MOE_FACTOR : 1);
    notes.push('Pas de carte NVIDIA vue : tout sur le processeur.');
  } else if (useExperts && spec.sharedBytes + kv + overhead <= usable) {
    placement = 'experts-in-ram';
    vram = spec.sharedBytes + kv + overhead;
    speed = MOE_FACTOR / (spec.sharedBytes / bw.gpu + spec.expertBytesPerToken / bw.ram);
  } else if (weights + kv + overhead <= usable) {
    placement = 'gpu';
    vram = weights + kv + overhead;
    const perToken =
      spec.architecture === 'moe' ? spec.sharedBytes + spec.expertBytesPerToken : weights;
    speed = (bw.gpu / perToken) * (spec.architecture === 'moe' ? MOE_FACTOR : 1);
  } else {
    placement = 'split';
    const onGpu = Math.max(0, Math.min(1, (usable - kv - overhead) / weights));
    vram = Math.min(usable, onGpu * weights + kv + overhead);
    const perToken =
      spec.architecture === 'moe' ? spec.sharedBytes + spec.expertBytesPerToken : weights;
    speed = split(perToken, onGpu) * (spec.architecture === 'moe' ? MOE_FACTOR : 1);
    if (useExperts)
      notes.push(
        'Même avec les experts en RAM, la partie carte ne tiendrait pas : répartition automatique.',
      );
  }
  const ram =
    Math.max(0.5e9, weights - Math.max(0, vram - kv - overhead)) + (useExperts ? 0.5e9 : 0);
  const fits = ram <= hardware.totalRamBytes - SYSTEM_RAM_RESERVE;
  if (!fits)
    notes.push(
      `Il faudrait environ ${(ram / 1e9).toFixed(0)} Go de RAM en plus de Windows : trop pour ce PC.`,
    );
  const diskOk =
    hardware.modelsDirFreeBytes === null ? null : hardware.modelsDirFreeBytes >= weights + 5e9;
  if (diskOk === false) notes.push('Pas assez de place sur le disque des modèles.');
  if (bw.basis === 'par défaut')
    notes.push('Pas d’étalonnage : débits par défaut, estimation moins sûre.');
  const round = (value: number) => Math.max(0.5, Math.round(value * 10) / 10);
  return {
    modelId: spec.id,
    expertsInRam: useExperts,
    placement,
    fits,
    vramBytes: vram,
    ramBytes: ram,
    diskOk,
    tokPerSec: { low: round(speed * 0.75), high: round(speed * 1.25) },
    publishedTokPerSec: spec.publishedTokPerSec,
    basis: bw.basis,
    notes,
  };
}
