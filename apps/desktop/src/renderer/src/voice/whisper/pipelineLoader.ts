import { configureOnnxRuntime, withOrtLock } from '../onnxRuntime';
import {
  WHISPER_LOAD_TIMEOUT_MS,
  WHISPER_RETRY_AFTER_MS,
  WHISPER_TRANSCRIBE_TIMEOUT_MS,
  WhisperTranscribeTimeoutError,
  createWhisperLoader,
  type TranscribeOptions,
  type WhisperLoadProgress,
} from './loaderCore';
import { deserializeWhisperError, type WhisperWorkerRequest, type WhisperWorkerResponse } from './workerProtocol';

export * from './loaderCore';

export interface WhisperBackend {
  getPipeline: (options?: { force?: boolean }) => Promise<unknown>;
  transcribe: (pcm: Float32Array, options?: TranscribeOptions) => Promise<string>;
  subscribe: (listener: (info: WhisperLoadProgress) => void) => () => void;
  lastProgress: () => WhisperLoadProgress | null;
}

export interface WorkerLike {
  postMessage: (message: WhisperWorkerRequest, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<WhisperWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate: () => void;
}

/** Au-delà, la page considère le worker perdu (il borne lui-même chargement et transcription). */
const WORKER_GUARD_MS = WHISPER_LOAD_TIMEOUT_MS + WHISPER_TRANSCRIBE_TIMEOUT_MS + 5_000;

/**
 * Whisper dans un worker (`whisperWorker.ts`). Si le worker ne démarre pas
 * (script illisible, worker refusé), la page reprend Whisper elle-même
 * (`fallback`, le chargeur de 0.4.16) : jamais de dictée perdue pour ça.
 */
export function createWorkerWhisperBackend(
  createWorker: () => WorkerLike,
  fallback: WhisperBackend,
  log: (line: string) => void = () => undefined,
): WhisperBackend {
  const listeners = new Set<(info: WhisperLoadProgress) => void>();
  let lastProgress: WhisperLoadProgress | null = null;
  let broken = false;
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void; retry: () => Promise<unknown> }>();

  const emit = (info: WhisperLoadProgress): void => {
    lastProgress = info;
    for (const listener of listeners) listener(info);
  };
  fallback.subscribe((info) => {
    if (broken) emit(info);
  });

  const giveUp = (reason: string): void => {
    if (broken) return;
    broken = true;
    log(`worker Whisper indisponible (${reason}) : Whisper repasse dans la page`);
    try {
      worker?.terminate();
    } catch {
      // déjà arrêté
    }
    const waiting = [...pending.values()];
    pending.clear();
    for (const call of waiting) call.retry().then(call.resolve, call.reject);
  };

  let worker: WorkerLike | null = null;
  try {
    worker = createWorker();
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'ready') {
        log(`worker Whisper prêt (${message.threads} thread${message.threads > 1 ? 's' : ''})`);
        return;
      }
      if (message.type === 'progress') {
        emit(message.info);
        return;
      }
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.type === 'failed') call.reject(deserializeWhisperError(message.error));
      else if (message.type === 'text') call.resolve(message.text);
      else call.resolve(undefined);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      giveUp(event.message || 'erreur du worker');
    };
  } catch (error) {
    giveUp(error instanceof Error ? error.message : String(error));
  }

  const request = <T>(build: (id: number) => { message: WhisperWorkerRequest; transfer?: Transferable[] }, retry: () => Promise<T>): Promise<T> => {
    if (broken || !worker) return retry();
    nextId += 1;
    const id = nextId;
    const { message, transfer } = build(id);
    return new Promise<T>((resolve, reject) => {
      const guard = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new WhisperTranscribeTimeoutError(WORKER_GUARD_MS));
      }, WORKER_GUARD_MS);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(guard);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(guard);
          reject(error);
        },
        retry: retry as () => Promise<unknown>,
      });
      worker!.postMessage(message, transfer);
    });
  };

  return {
    getPipeline: (options = {}) =>
      request((id) => ({ message: { type: 'load', id, force: options.force } }), () => fallback.getPipeline(options)),
    transcribe: (pcm, options = {}) =>
      request(
        (id) => {
          const copy = pcm.slice();
          return { message: { type: 'transcribe', id, pcm: copy, options }, transfer: [copy.buffer] };
        },
        () => fallback.transcribe(pcm, options),
      ),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lastProgress: () => lastProgress,
  };
}

let backend: WhisperBackend | null = null;

function whisperLog(line: string): void {
  try {
    window.jarvis?.voice?.log?.(`[whisper] ${line}`);
  } catch {
    // Journal seulement.
  }
}

function defaultBackend(): WhisperBackend {
  if (backend) return backend;
  const inPage = createWhisperLoader({
    importTransformers: () => import('@huggingface/transformers'),
    configureRuntime: () => configureOnnxRuntime(),
    runExclusive: withOrtLock,
    now: () => performance.now(),
    loadTimeoutMs: WHISPER_LOAD_TIMEOUT_MS,
    retryAfterMs: WHISPER_RETRY_AFTER_MS,
    transcribeTimeoutMs: WHISPER_TRANSCRIBE_TIMEOUT_MS,
  });
  backend =
    typeof Worker === 'undefined'
      ? inPage
      : createWorkerWhisperBackend(
          () => new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
          inPage,
          whisperLog,
        );
  return backend;
}

/** Le seul Whisper de l'application : dictée, confirmation du mot de réveil, YouTube. */
export const getWhisperPipeline = (options?: { force?: boolean }): Promise<unknown> => defaultBackend().getPipeline(options);
export const transcribeWithWhisper = (pcm: Float32Array, options?: TranscribeOptions): Promise<string> =>
  defaultBackend().transcribe(pcm, options);
export const subscribeWhisperProgress = (listener: (info: WhisperLoadProgress) => void): (() => void) =>
  defaultBackend().subscribe(listener);
export const lastWhisperProgress = (): WhisperLoadProgress | null => defaultBackend().lastProgress();
