import type * as Ort from 'onnxruntime-web';
import {
  OPENWAKEWORD_MEL_BINS,
  OPENWAKEWORD_MEL_WINDOW,
  voiceAssetUrl,
  wakeClipFeatures,
  type OpenWakeWordModelFile,
  type WakeEmbeddingRunner,
} from '@jarvis/core';
import { configureOnnxRuntime, withOrtLock } from '../onnxRuntime';

interface FeatureModels {
  ort: typeof Ort;
  mel: Ort.InferenceSession;
  embedding: Ort.InferenceSession;
}

let models: Promise<FeatureModels> | null = null;

async function loadModels(): Promise<FeatureModels> {
  const ort = await configureOnnxRuntime();
  const load = async (name: OpenWakeWordModelFile) => {
    const url = voiceAssetUrl('openwakeword', name);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} pour ${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return withOrtLock(() => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }));
  };
  const [mel, embedding] = await Promise.all([load('melspectrogram.onnx'), load('embedding_model.onnx')]);
  return { ort, mel, embedding };
}

function runner({ ort, mel, embedding }: FeatureModels): WakeEmbeddingRunner {
  return {
    // Un verrou par appel : le moteur openWakeWord garde la main entre deux pas.
    mel: (pcm) =>
      withOrtLock(async () => {
        const output = await mel.run({ [mel.inputNames[0]!]: new ort.Tensor('float32', pcm, [1, pcm.length]) });
        return new Float32Array(output[mel.outputNames[0]!]!.data as Float32Array);
      }),
    embedding: (window) =>
      withOrtLock(async () => {
        const output = await embedding.run({
          [embedding.inputNames[0]!]: new ort.Tensor('float32', window, [
            1,
            OPENWAKEWORD_MEL_WINDOW,
            OPENWAKEWORD_MEL_BINS,
            1,
          ]),
        });
        return new Float32Array(output[embedding.outputNames[0]!]!.data as Float32Array);
      }),
  };
}

/**
 * Caractéristiques openWakeWord d'un extrait de 2 s (mêmes modèles mel et
 * embedding que le détecteur, sessions à part chargées au premier besoin).
 * `null` si les modèles sont indisponibles : la couche laisse alors passer.
 */
export async function computeWakeFeatures(clip: Float32Array): Promise<number[] | null> {
  try {
    models ??= loadModels();
    return await wakeClipFeatures(clip, runner(await models));
  } catch {
    models = null;
    return null;
  }
}
