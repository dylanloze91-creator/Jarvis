import { formatBytes } from './environmentCheck.js';
import type { CheckReport, DevCheck } from './repoCheck.js';

const MIB = 1024 * 1024;

export interface GpuInfo {
  name: string;
  totalMiB: number;
  usedMiB: number;
  freeMiB: number;
  driver: string | null;
}

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  parameterSize: string;
  quantization: string;
  supportsTools: boolean;
}

export interface HardwareFacts {
  platform: string;
  cpuModel: string;
  logicalCores: number;
  totalRamBytes: number;
  freeRamBytes: number;
  gpus: GpuInfo[];
  /** `absent` : nvidia-smi introuvable (pas de carte NVIDIA, ou pilote absent). */
  gpuProbe: 'ok' | 'absent' | 'error';
  modelsDir: string;
  modelsDirFreeBytes: number | null;
  ollama: {
    status: 'detected' | 'absent' | 'unreachable';
    version: string | null;
    models: InstalledModel[];
  };
}

/** Sortie de `nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,driver_version --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(output: string): GpuInfo[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.split(',').map((part) => part.trim()))
    .filter((parts) => parts.length >= 4 && parts[0])
    .map(([name, total, used, free, driver]) => ({
      name: name!,
      totalMiB: Number(total) || 0,
      usedMiB: Number(used) || 0,
      freeMiB: Number(free) || 0,
      driver: driver || null,
    }));
}

export function mainGpu(facts: Pick<HardwareFacts, 'gpus'>): GpuInfo | null {
  return [...facts.gpus].sort((a, b) => b.totalMiB - a.totalMiB)[0] ?? null;
}

/** Au moins le modèle par défaut (23 Go) et de la marge. */
export const MIN_MODELS_FREE_BYTES = 30 * 1e9;

export function checkHardware(facts: HardwareFacts): CheckReport {
  const checks: DevCheck[] = [];
  const ramGb = facts.totalRamBytes / 1024 ** 3;
  checks.push({
    id: 'ram',
    label: 'Mémoire vive',
    status: ramGb >= 32 ? 'ok' : ramGb >= 16 ? 'warn' : 'fail',
    detail: `${formatBytes(facts.totalRamBytes)} au total, ${formatBytes(facts.freeRamBytes)} libres maintenant${ramGb >= 32 ? '' : ramGb >= 16 ? ' : seul le modèle rapide est conseillé' : ' : trop peu pour un modèle de code'}.`,
  });
  checks.push({
    id: 'cpu',
    label: 'Processeur',
    status: 'ok',
    detail: `${facts.cpuModel || 'inconnu'}, ${facts.logicalCores} fils`,
  });
  const gpu = mainGpu(facts);
  if (gpu) {
    checks.push({
      id: 'gpu',
      label: 'Carte graphique',
      status: 'ok',
      detail: `${gpu.name}, ${formatBytes(gpu.totalMiB * MIB)} dont ${formatBytes(gpu.usedMiB * MIB)} déjà utilisés${gpu.driver ? ` (pilote ${gpu.driver})` : ''}.`,
    });
  } else {
    checks.push({
      id: 'gpu',
      label: 'Carte graphique',
      status: 'warn',
      detail:
        facts.gpuProbe === 'absent'
          ? 'nvidia-smi introuvable : pas de carte NVIDIA vue, les modèles tourneraient sur le processeur (lent).'
          : 'Mémoire de la carte illisible (nvidia-smi en erreur).',
    });
  }
  if (facts.modelsDirFreeBytes === null) {
    checks.push({
      id: 'disk',
      label: 'Disque des modèles',
      status: 'warn',
      detail: `Espace libre inconnu (${facts.modelsDir}).`,
    });
  } else {
    checks.push({
      id: 'disk',
      label: 'Disque des modèles',
      status:
        facts.modelsDirFreeBytes >= MIN_MODELS_FREE_BYTES
          ? 'ok'
          : facts.modelsDirFreeBytes >= 5e9
            ? 'warn'
            : 'fail',
      detail: `${formatBytes(facts.modelsDirFreeBytes)} libres pour ${facts.modelsDir}${facts.modelsDirFreeBytes >= MIN_MODELS_FREE_BYTES ? '' : ` : le modèle par défaut demande 23 Go`}.`,
    });
  }
  const { ollama } = facts;
  checks.push(
    ollama.status === 'detected'
      ? {
          id: 'ollama',
          label: 'Ollama',
          status: 'ok',
          detail: `Ollama ${ollama.version ?? '?'}, ${ollama.models.length} modèle(s) installé(s).`,
        }
      : {
          id: 'ollama',
          label: 'Ollama',
          status: 'fail',
          detail:
            'Ollama ne répond pas : démarre-le (icône près de l’horloge), puis relance la vérification.',
        },
  );
  return { ok: checks.every((check) => check.status !== 'fail'), checks };
}
