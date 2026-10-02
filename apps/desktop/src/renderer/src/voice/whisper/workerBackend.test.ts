import { describe, expect, it, vi } from 'vitest';
import type { WhisperBackend, WorkerLike } from './pipelineLoader';
import type { WhisperWorkerRequest } from './workerProtocol';

vi.mock('../onnxRuntime', () => ({ configureOnnxRuntime: vi.fn(async () => ({})), withOrtLock: <T,>(task: () => Promise<T>) => task() }));

const { createWorkerWhisperBackend, WhisperLoadTimeoutError } = await import('./pipelineLoader');
const { deserializeWhisperError, serializeWhisperError, whisperThreadCount } = await import('./workerProtocol');

function fakeFallback(text = 'repli'): WhisperBackend & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    getPipeline: vi.fn(async () => ({})),
    transcribe: vi.fn(async () => text),
    subscribe: () => () => undefined,
    lastProgress: () => null,
  };
}

function fakeWorker() {
  const sent: WhisperWorkerRequest[] = [];
  const worker: WorkerLike = {
    postMessage: (message) => sent.push(message),
    onmessage: null,
    onerror: null,
    terminate: vi.fn(),
  };
  const reply = (data: unknown): void => worker.onmessage?.({ data } as MessageEvent);
  return { worker, sent, reply };
}

describe('Whisper dans un worker', () => {
  it('envoie l’audio au worker et rend son texte', async () => {
    const { worker, sent, reply } = fakeWorker();
    const fallback = fakeFallback();
    const backend = createWorkerWhisperBackend(() => worker, fallback);
    const pcm = new Float32Array([0.1, 0.2]);
    const result = backend.transcribe(pcm, { language: 'french' });
    expect(sent[0]).toMatchObject({ type: 'transcribe', id: 1 });
    // L'appelant garde son audio : le worker reçoit une copie transférée.
    expect(pcm[0]).toBeCloseTo(0.1);
    reply({ type: 'text', id: 1, text: 'quelle heure est-il ?' });
    await expect(result).resolves.toBe('quelle heure est-il ?');
    expect(fallback.transcribe).not.toHaveBeenCalled();
  });

  it('repasse dans la page si le worker plante, sans perdre la dictée en cours', async () => {
    const { worker } = fakeWorker();
    const fallback = fakeFallback('texte du repli');
    const lines: string[] = [];
    const backend = createWorkerWhisperBackend(() => worker, fallback, (line) => lines.push(line));
    const result = backend.transcribe(new Float32Array(4));
    worker.onerror?.({ message: 'script illisible', preventDefault: () => undefined } as ErrorEvent);
    await expect(result).resolves.toBe('texte du repli');
    await expect(backend.transcribe(new Float32Array(4))).resolves.toBe('texte du repli');
    expect(lines.join('\n')).toMatch(/repasse dans la page/);
  });

  it('repasse dans la page si le worker ne peut pas être créé', async () => {
    const fallback = fakeFallback('ok');
    const backend = createWorkerWhisperBackend(() => {
      throw new Error('Worker refusé');
    }, fallback);
    await expect(backend.transcribe(new Float32Array(4))).resolves.toBe('ok');
  });

  it('garde le type d’erreur précis venu du worker', async () => {
    const { worker, reply } = fakeWorker();
    const backend = createWorkerWhisperBackend(() => worker, fakeFallback());
    const load = backend.getPipeline();
    reply({ type: 'failed', id: 1, error: serializeWhisperError(new WhisperLoadTimeoutError('session', 90_000)) });
    await expect(load).rejects.toBeInstanceOf(WhisperLoadTimeoutError);
  });
});

describe('protocole du worker', () => {
  it('utilise la moitié des cœurs (4 au plus), 1 sans mémoire partagée', () => {
    expect(whisperThreadCount(false, 16)).toBe(1);
    expect(whisperThreadCount(true, 4)).toBe(2);
    expect(whisperThreadCount(true, 16)).toBe(4);
    expect(whisperThreadCount(true, 1)).toBe(1);
    expect(whisperThreadCount(true, undefined)).toBe(1);
  });

  it('reconstruit une erreur générique avec son message', () => {
    const error = deserializeWhisperError(serializeWhisperError(new Error('panne')));
    expect(error.message).toBe('panne');
  });
});
