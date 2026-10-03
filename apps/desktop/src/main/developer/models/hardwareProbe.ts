import os from 'node:os';
import { join } from 'node:path';
import { parseNvidiaSmi, type HardwareFacts } from '@jarvis/core';
import type { Runner } from '../runner.js';
import type { OllamaApi } from './ollamaApi.js';
import { devPlatform, NVIDIA_SMI_ARGS, type DevPlatform } from '../platform/index.js';

export { NVIDIA_SMI_ARGS };

export interface HardwareProbeDeps {
  run: Runner;
  ollama: OllamaApi;
  home: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  freeBytes: (path: string) => Promise<number | null>;
  os?: Pick<typeof os, 'totalmem' | 'freemem' | 'cpus'>;
}

/** Dossier des modèles d'Ollama : OLLAMA_MODELS s'il est défini, sinon ~/.ollama/models. */
export function ollamaModelsDir(env: Record<string, string | undefined>, home: string): string {
  return env.OLLAMA_MODELS?.trim() || join(home, '.ollama', 'models');
}

export async function readGpuMemory(
  run: Runner,
  cwd: string,
  platform: DevPlatform = devPlatform(),
): Promise<{ probe: HardwareFacts['gpuProbe']; output: string }> {
  const query = platform.gpuQuery;
  if (!query) return { probe: 'absent', output: '' };
  try {
    const outcome = await run({
      program: query.program,
      args: [...query.args],
      cwd,
      timeoutMs: 10_000,
      display: query.program,
    });
    if (outcome.error)
      return { probe: /ENOENT/.test(outcome.error) ? 'absent' : 'error', output: '' };
    return { probe: outcome.code === 0 ? 'ok' : 'error', output: outcome.stdout };
  } catch {
    return { probe: 'error', output: '' };
  }
}

/** Relevé du matériel avant tout téléchargement : RAM, carte (nvidia-smi), disque des modèles, Ollama. */
export async function probeHardware(deps: HardwareProbeDeps): Promise<HardwareFacts> {
  const system = deps.os ?? os;
  const modelsDir = ollamaModelsDir(deps.env, deps.home);
  const [gpu, status, free] = await Promise.all([
    readGpuMemory(deps.run, deps.home),
    deps.ollama.status(),
    deps.freeBytes(modelsDir),
  ]);
  const cpus = system.cpus();
  return {
    platform: deps.platform,
    cpuModel: cpus[0]?.model?.trim() ?? '',
    logicalCores: cpus.length,
    totalRamBytes: system.totalmem(),
    freeRamBytes: system.freemem(),
    gpus: gpu.probe === 'ok' ? parseNvidiaSmi(gpu.output) : [],
    gpuProbe: gpu.probe,
    modelsDir,
    modelsDirFreeBytes: free,
    ollama: {
      status: status.status,
      version: status.version ?? null,
      models: status.models.map((model) => ({
        name: model.name,
        sizeBytes: model.sizeBytes,
        parameterSize: model.parameterSize,
        quantization: model.quantizationLevel,
        supportsTools: model.supportsTools,
      })),
    },
  };
}
