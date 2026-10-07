import { afterEach, describe, expect, it, vi } from 'vitest';
import { WHISPER_MODEL_REPO } from '@jarvis/core';
import { ModelRegistry, env } from '@huggingface/transformers';

vi.mock('../onnxRuntime', () => ({ configureOnnxRuntime: vi.fn(), withOrtLock: <T,>(task: () => Promise<T>) => task() }));
const { configureTransformersEnv } = await import('./pipelineLoader');

/**
 * Le vrai code de transformers.js 4.x (pas un double) détecte le tokenizer
 * et `preprocessor_config.json` avant de construire le pipeline. On lui
 * sert des URL `jarvis-oww://` comme le fait le processus principal.
 */
const MODEL_FILES = new Set([
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
]);

function jarvisOwwFetch(requests: string[]) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (!url.startsWith('jarvis-oww://whisper/')) throw new TypeError('Failed to fetch');
    const file = url.split('/').pop()!;
    if (!MODEL_FILES.has(file)) return new Response('Fichier introuvable', { status: 404 });
    const body = '{}';
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
    });
  };
}

const saved = { ...env };
afterEach(() => Object.assign(env, saved));

describe('détection des fichiers Whisper par transformers.js via jarvis-oww', () => {
  it('reproduit le bug 0.4.9/0.4.10 : en mode « Hub distant » sur jarvis-oww, tout passe pour absent', async () => {
    const requests: string[] = [];
    Object.assign(env, {
      allowLocalModels: false,
      allowRemoteModels: true,
      remoteHost: 'jarvis-oww://whisper/',
      remotePathTemplate: '{model}/',
      useBrowserCache: false,
      useFS: false,
      useFSCache: false,
      fetch: jarvisOwwFetch(requests),
    });
    expect(await ModelRegistry.get_tokenizer_files('ancien/whisper-base')).toEqual([]);
    expect(await ModelRegistry.get_processor_files('ancien/whisper-base')).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('avec la configuration « modèle local », tokenizer et processeur sont trouvés', async () => {
    const requests: string[] = [];
    Object.assign(env, { useFSCache: false, fetch: jarvisOwwFetch(requests) });
    configureTransformersEnv(env);
    expect(await ModelRegistry.get_tokenizer_files(WHISPER_MODEL_REPO)).toEqual([
      'tokenizer.json',
      'tokenizer_config.json',
    ]);
    expect(await ModelRegistry.get_processor_files(WHISPER_MODEL_REPO)).toEqual([
      'preprocessor_config.json',
    ]);
    expect(requests).toContain(`jarvis-oww://whisper/${WHISPER_MODEL_REPO}/tokenizer_config.json`);
    expect(requests).toContain(`jarvis-oww://whisper/${WHISPER_MODEL_REPO}/preprocessor_config.json`);
    expect(requests.every((url) => url.startsWith('jarvis-oww://whisper/'))).toBe(true);
  });
});
