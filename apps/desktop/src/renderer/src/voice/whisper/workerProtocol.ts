import {
  WhisperIncompleteError,
  WhisperLoadTimeoutError,
  WhisperTranscribeTimeoutError,
  type TranscribeOptions,
  type WhisperLoadProgress,
  type WhisperLoadStage,
} from './loaderCore';

export type WhisperWorkerRequest =
  | { type: 'load'; id: number; force?: boolean }
  | { type: 'transcribe'; id: number; pcm: Float32Array; options: TranscribeOptions };

export interface SerializedWhisperError {
  name: string;
  message: string;
  stage?: WhisperLoadStage;
  timeoutMs?: number;
  missing?: string[];
}

export type WhisperWorkerResponse =
  | { type: 'ready'; threads: number }
  | { type: 'progress'; info: WhisperLoadProgress }
  | { type: 'loaded'; id: number; threads: number }
  | { type: 'text'; id: number; text: string }
  | { type: 'failed'; id: number; error: SerializedWhisperError };

/** Threads de Whisper : la moitié des cœurs logiques, 4 au plus ; 1 sans SharedArrayBuffer. */
export function whisperThreadCount(sharedMemory: boolean, hardwareConcurrency: number | undefined): number {
  if (!sharedMemory) return 1;
  const cores = Number.isFinite(hardwareConcurrency) && hardwareConcurrency ? hardwareConcurrency : 2;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

export function serializeWhisperError(error: unknown): SerializedWhisperError {
  if (error instanceof WhisperLoadTimeoutError) {
    return { name: error.name, message: error.message, stage: error.stage, timeoutMs: error.timeoutMs };
  }
  if (error instanceof WhisperTranscribeTimeoutError) {
    return { name: error.name, message: error.message, timeoutMs: error.timeoutMs };
  }
  if (error instanceof WhisperIncompleteError) {
    return { name: error.name, message: error.message, missing: error.missing };
  }
  if (error instanceof Error) {
    const cause = error.cause !== undefined ? ` (${String((error.cause as { message?: unknown })?.message ?? error.cause)})` : '';
    return { name: error.name, message: `${error.message}${cause}` };
  }
  return { name: 'Error', message: typeof error === 'string' ? error : JSON.stringify(error) ?? String(error) };
}

/** Recrée l'erreur d'origine : `describeWhisperLoadError` garde ses messages précis. */
export function deserializeWhisperError(error: SerializedWhisperError): Error {
  if (error.name === 'WhisperLoadTimeoutError' && error.stage && error.timeoutMs !== undefined) {
    return new WhisperLoadTimeoutError(error.stage, error.timeoutMs);
  }
  if (error.name === 'WhisperTranscribeTimeoutError' && error.timeoutMs !== undefined) {
    return new WhisperTranscribeTimeoutError(error.timeoutMs);
  }
  if (error.name === 'WhisperIncompleteError' && error.missing) {
    return new WhisperIncompleteError(error.missing);
  }
  const rebuilt = new Error(error.message);
  rebuilt.name = error.name;
  return rebuilt;
}
