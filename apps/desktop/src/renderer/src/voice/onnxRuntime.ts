import * as ort from 'onnxruntime-web';
import { ORT_WASM_BINARY, ORT_WASM_MJS, voiceAssetUrl } from '@jarvis/core';

/**
 * Au-delà, onnxruntime-web rejette l'initialisation WebAssembly au lieu
 * d'attendre indéfiniment (`env.wasm.initTimeout`, 0 = jamais par défaut).
 */
export const ORT_INIT_TIMEOUT_MS = 30_000;

let configured: Promise<typeof ort> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Un seul appel au runtime à la fois (création de session ou `run`), pour
 * Whisper comme pour openWakeWord : ils partagent la même instance
 * WebAssembly, et des `run` entrelacés avec le décodage de Whisper la
 * corrompaient (renderer tué par SIGSEGV quelques secondes après « Jarvis »).
 * Ne jamais rappeler `withOrtLock` depuis `task` (blocage).
 */
export function withOrtLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function fetchOk(url: string, fetchImpl: typeof fetch): Promise<Response> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} pour ${url}`);
  return response;
}

/**
 * Configure l'unique runtime ONNX (onnxruntime-web, build WebAssembly seul)
 * partagé par Whisper (transformers.js l'importe sous `onnxruntime-web/webgpu`,
 * alias Vite vers le même fichier) et par openWakeWord. Le `.wasm` est lu
 * une fois via `jarvis-oww:` et passé en `wasmBinary` ; le `.mjs` est servi
 * en blob (onnxruntime-web ≥ 1.24.3 gère ce couple, PR microsoft/onnxruntime#27411).
 * Un seul thread : la page `file://` n'est pas cross-origin isolated.
 */
export function configureOnnxRuntime(fetchImpl: typeof fetch = fetch): Promise<typeof ort> {
  if (configured) return configured;
  configured = (async () => {
    const mjsUrl = voiceAssetUrl('ort', ORT_WASM_MJS);
    const wasmUrl = voiceAssetUrl('ort', ORT_WASM_BINARY);
    const [mjsText, wasmBinary] = await Promise.all([
      fetchOk(mjsUrl, fetchImpl).then((response) => response.text()),
      fetchOk(wasmUrl, fetchImpl).then((response) => response.arrayBuffer()),
    ]);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.initTimeout = ORT_INIT_TIMEOUT_MS;
    ort.env.wasm.wasmBinary = wasmBinary;
    ort.env.wasm.wasmPaths = {
      mjs: URL.createObjectURL(new Blob([mjsText], { type: 'text/javascript' })),
      wasm: wasmUrl,
    };
    return ort;
  })().catch((error: unknown) => {
    configured = null;
    throw error;
  });
  return configured;
}

export function onnxRuntimeVersion(): string {
  return ort.env.versions?.web ?? 'inconnue';
}
