import {
  createCodeAIProvider,
  type CalibrationRun,
  type InstalledModel,
  type ProviderRegistry,
} from '@jarvis/core';
import type { OllamaApi } from './ollamaApi.js';

export const CALIBRATION_PROMPT =
  'Écris dix phrases courtes et différentes sur la météo, numérotées de 1 à 10.';
const CALIBRATION_TOKENS = 160;

/** Modèle d'étalonnage : celui du chat s'il est installé, sinon qwen2.5:3b, sinon le plus petit modèle de dialogue installé. */
export function pickCalibrationModel(
  installed: InstalledModel[],
  chatModel: string | null,
): InstalledModel | null {
  const chatCapable = installed.filter((model) => !/embed/i.test(model.name));
  return (
    chatCapable.find((model) => model.name === chatModel) ??
    chatCapable.find((model) => model.name === 'qwen2.5:3b') ??
    [...chatCapable].sort((a, b) => a.sizeBytes - b.sizeBytes)[0] ??
    null
  );
}

export interface CalibrationDeps {
  registry: ProviderRegistry;
  ollama: OllamaApi;
  model: InstalledModel;
  signal?: AbortSignal;
  onRun?: (mode: CalibrationRun['mode']) => void;
}

/**
 * Deux courtes générations sur un modèle déjà installé : placement normal,
 * puis tout sur le processeur (num_gpu 0). Rien n'est téléchargé. Le modèle
 * est rechargé : le prochain message du chat peut attendre quelques secondes.
 */
export async function runCalibration(deps: CalibrationDeps): Promise<CalibrationRun[]> {
  const runs: CalibrationRun[] = [];
  for (const mode of ['auto', 'cpu'] as const) {
    deps.onRun?.(mode);
    const provider = createCodeAIProvider(deps.registry, {
      model: deps.model.name,
      baseUrl: deps.ollama.baseUrl,
      options:
        mode === 'cpu'
          ? { numCtx: 8192, numGpu: 0, keepAlive: '1m' }
          : { numCtx: 8192, keepAlive: '5m' },
    });
    const { usage } = await provider.complete({
      system: 'Tu réponds en français.',
      prompt: CALIBRATION_PROMPT,
      maxTokens: CALIBRATION_TOKENS,
      signal: deps.signal,
    });
    if (!usage || usage.outputTokens === 0)
      throw new Error(`Ollama n’a rendu aucune mesure pour ${deps.model.name}.`);
    const loaded = (await deps.ollama.running()).find(
      (running) => running.name === deps.model.name,
    );
    runs.push({
      model: deps.model.name,
      modelBytes: deps.model.sizeBytes,
      mode,
      sizeBytes: loaded?.sizeBytes ?? 0,
      sizeVramBytes: loaded?.sizeVramBytes ?? 0,
      outputTokens: usage.outputTokens,
      outputMs: usage.outputMs,
      promptTokens: usage.promptTokens,
      promptMs: usage.promptMs,
      loadMs: usage.loadMs,
    });
  }
  return runs;
}
