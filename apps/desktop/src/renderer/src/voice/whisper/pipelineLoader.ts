import type { AutomaticSpeechRecognitionPipeline, ProgressInfo } from '@huggingface/transformers';

/**
 * Chargement et mise en cache des pipelines Whisper (transformers.js /
 * ONNX Runtime Web) : WebAssembly pur, aucune compilation native, aucun
 * binaire à installer. Vit dans `apps/desktop` (le renderer, qui a le DOM)
 * — jamais dans `packages/core`.
 *
 * Le modèle n'est PAS embarqué dans l'installateur : `pipeline()` le
 * télécharge au premier appel pour un `repo` donné, et transformers.js le
 * met en cache lui-même (Cache API du navigateur), donc les lancements
 * suivants sont hors ligne. C'est exactement le comportement demandé
 * (léger à l'installation, autonome ensuite) — rien à coder ici pour le
 * cache, seulement pour la progression affichée à l'utilisateur pendant le
 * premier téléchargement.
 *
 * `@huggingface/transformers` est importé dynamiquement (jamais en haut de
 * fichier) : c'est une dépendance lourde, à ne charger que si la commande
 * vocale locale est effectivement utilisée — même logique que Porcupine
 * dans `porcupineWakeWordEngine.ts`.
 */
export type WhisperDevice = 'webgpu' | 'wasm';

export interface WhisperLoadProgress {
  repo: string;
  status: 'loading' | 'ready' | 'error';
  /** 0 à 100, uniquement pendant le téléchargement (`status === 'loading'`). */
  progress?: number;
  loadedBytes?: number;
  totalBytes?: number;
  device?: WhisperDevice;
  message?: string;
}

type ProgressListener = (info: WhisperLoadProgress) => void;

const listeners = new Set<ProgressListener>();
const pipelineCache = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>();

export function subscribeWhisperProgress(listener: ProgressListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(info: WhisperLoadProgress): void {
  for (const listener of listeners) listener(info);
}

/** Vrai si l'état actuel d'un dépôt (déjà en cache ou en cours de chargement) est connu. */
export function isWhisperPipelineCached(repo: string): boolean {
  return pipelineCache.has(repo);
}

/**
 * WebGPU si le navigateur l'expose, sinon repli WebAssembly (toujours
 * disponible). `navigator.gpu` n'étant qu'une annonce d'API — pas une
 * garantie qu'un adaptateur réel réponde — `getWhisperPipeline` retente en
 * WebAssembly si le chargement WebGPU échoue malgré tout.
 */
export function detectWhisperDevice(): WhisperDevice {
  const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  return gpu ? 'webgpu' : 'wasm';
}

async function loadPipeline(
  repo: string,
  device: WhisperDevice,
): Promise<AutomaticSpeechRecognitionPipeline> {
  const { pipeline } = await import('@huggingface/transformers');
  return pipeline('automatic-speech-recognition', repo, {
    device,
    dtype: 'q8',
    progress_callback: (info: ProgressInfo) => {
      if (info.status === 'progress_total') {
        emit({
          repo,
          status: 'loading',
          device,
          progress: info.progress,
          loadedBytes: info.loaded,
          totalBytes: info.total,
        });
      }
    },
  }) as unknown as Promise<AutomaticSpeechRecognitionPipeline>;
}

/**
 * Charge (et met en cache) le pipeline Whisper pour `repo`. Un même dépôt
 * n'est jamais chargé deux fois : un second appel pendant que le premier
 * télécharge encore reçoit la même promesse.
 */
export function getWhisperPipeline(repo: string): Promise<AutomaticSpeechRecognitionPipeline> {
  const cached = pipelineCache.get(repo);
  if (cached) return cached;

  const preferredDevice = detectWhisperDevice();
  const loadPromise = loadPipeline(repo, preferredDevice)
    .catch(async (error: unknown) => {
      if (preferredDevice !== 'webgpu') throw error;
      emit({
        repo,
        status: 'loading',
        device: 'wasm',
        message: 'WebGPU indisponible, repli sur WebAssembly.',
      });
      return loadPipeline(repo, 'wasm');
    })
    .then((pipe) => {
      emit({ repo, status: 'ready' });
      return pipe;
    })
    .catch((error: unknown) => {
      pipelineCache.delete(repo);
      emit({ repo, status: 'error', message: describeError(error) });
      throw error;
    });

  pipelineCache.set(repo, loadPromise);
  return loadPromise;
}

export interface TranscribeOptions {
  /** Nom complet de la langue attendu par Whisper (ex. "french"), pas un code ISO. */
  language?: string;
}

/** Transcrit une fenêtre PCM mono à 16 kHz (le débit attendu par Whisper, déjà celui de la capture — voir `audioCapture.ts`). */
export async function transcribeWithWhisper(
  repo: string,
  pcm: Float32Array,
  options: TranscribeOptions = {},
): Promise<string> {
  const pipe = await getWhisperPipeline(repo);
  const output = await pipe(pcm, {
    language: options.language ?? 'french',
    task: 'transcribe',
    chunk_length_s: 30,
  });
  const first = Array.isArray(output) ? output[0] : output;
  return first?.text?.trim() ?? '';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
