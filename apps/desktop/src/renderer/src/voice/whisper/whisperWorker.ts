/// <reference lib="webworker" />
/**
 * Whisper hors du fil de l'interface : le même chargeur que dans la page
 * (`createWhisperLoader`), le même onnxruntime-web (`ort.wasm.min.mjs`, lu
 * par jarvis-oww), mais dans ce worker et sur plusieurs threads. La page ne
 * fait plus que lui passer le PCM : l'interface et le micro ne gèlent plus
 * pendant une transcription.
 */
import { configureOnnxRuntime } from '../onnxRuntime';
import {
  WHISPER_LOAD_TIMEOUT_MS,
  WHISPER_RETRY_AFTER_MS,
  WHISPER_TRANSCRIBE_TIMEOUT_MS,
  createWhisperLoader,
} from './loaderCore';
import { serializeWhisperError, whisperThreadCount, type WhisperWorkerRequest, type WhisperWorkerResponse } from './workerProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WhisperWorkerResponse): void => scope.postMessage(message);

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};

const threads = whisperThreadCount(typeof SharedArrayBuffer !== 'undefined', navigator.hardwareConcurrency);

const loader = createWhisperLoader({
  importTransformers: () => import('@huggingface/transformers'),
  configureRuntime: () => configureOnnxRuntime(fetch, threads),
  runExclusive: serial,
  now: () => performance.now(),
  loadTimeoutMs: WHISPER_LOAD_TIMEOUT_MS,
  retryAfterMs: WHISPER_RETRY_AFTER_MS,
  transcribeTimeoutMs: WHISPER_TRANSCRIBE_TIMEOUT_MS,
});

loader.subscribe((info) => post({ type: 'progress', info }));

scope.onmessage = (event: MessageEvent<WhisperWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'load') {
    loader.getPipeline({ force: request.force }).then(
      () => post({ type: 'loaded', id: request.id, threads }),
      (error: unknown) => post({ type: 'failed', id: request.id, error: serializeWhisperError(error) }),
    );
    return;
  }
  if (request.type === 'transcribe') {
    loader.transcribe(request.pcm, request.options).then(
      (text) => post({ type: 'text', id: request.id, text }),
      (error: unknown) => post({ type: 'failed', id: request.id, error: serializeWhisperError(error) }),
    );
  }
};

post({ type: 'ready', threads });
