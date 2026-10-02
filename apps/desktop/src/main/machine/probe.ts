import { spawn } from 'node:child_process';
import os from 'node:os';
import { modelIsInstalled, type MachineMeasure } from '@jarvis/core';
import { measureFree } from '../developer/environment.js';
import { NVIDIA_SMI_ARGS, ollamaModelsDir, probeHardware } from '../developer/models/hardwareProbe.js';
import { createOllamaApi } from '../developer/models/ollamaApi.js';
import type { RunOutcome, Runner } from '../developer/runner.js';

export interface MachineSurvey extends MachineMeasure {
  installedModels: string[];
}

export function modelAlreadyInstalled(survey: MachineSurvey, model: string): boolean {
  return modelIsInstalled(survey.installedModels, model);
}

/** RAM, processeur, nvidia-smi, disque libre, Ollama. Une exception devient une mesure échouée. */
export async function surveyMachine(baseUrl: string): Promise<MachineSurvey> {
  try {
    const home = os.homedir();
    const facts = await probeHardware({
      run: nvidiaSmiOnly,
      ollama: createOllamaApi(baseUrl),
      home,
      platform: process.platform,
      env: process.env,
      freeBytes: (path) => measureFree(path),
    });
    const modelsDirFree = facts.modelsDirFreeBytes;
    const homeFree = modelsDirFree == null ? await measureFree(home) : modelsDirFree;
    return {
      failed: false,
      totalRamBytes: facts.totalRamBytes,
      cpuModel: facts.cpuModel,
      logicalCores: facts.logicalCores,
      gpus: facts.gpuProbe === 'ok' ? facts.gpus.map((gpu) => ({ name: gpu.name, totalMiB: gpu.totalMiB })) : [],
      gpuProbe: facts.gpuProbe,
      freeDiskBytes: homeFree,
      ollamaPresent: facts.ollama.status === 'detected',
      installedModels: facts.ollama.models.map((model) => model.name),
    };
  } catch {
    return {
      failed: true,
      totalRamBytes: 0,
      cpuModel: '',
      logicalCores: 0,
      gpus: [],
      gpuProbe: 'error',
      freeDiskBytes: null,
      ollamaPresent: false,
      installedModels: [],
    };
  }
}

/** nvidia-smi seul, arguments fixes, sans passer par le tri des commandes développeur. */
const nvidiaSmiOnly: Runner = (spec) => {
  const display = spec.display ?? 'nvidia-smi';
  if (spec.program !== 'nvidia-smi' || spec.args.join(' ') !== NVIDIA_SMI_ARGS.join(' ')) {
    return Promise.resolve(emptyOutcome(display, 'commande refusée'));
  }
  return new Promise<RunOutcome>((resolve) => {
    let stdout = '';
    let stderr = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('nvidia-smi', [...NVIDIA_SMI_ARGS], {
        cwd: spec.cwd || ollamaModelsDir(process.env, os.homedir()),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve(emptyOutcome(display, error instanceof Error ? error.message : 'ENOENT'));
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
    }, spec.timeoutMs);
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve(emptyOutcome(display, error.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        display,
        code,
        stdout,
        stderr,
        timedOut: false,
        cancelled: false,
        truncated: false,
        error: null,
      });
    });
  });
};

function emptyOutcome(display: string, error: string): RunOutcome {
  return {
    display,
    code: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    cancelled: false,
    truncated: false,
    error,
  };
}
