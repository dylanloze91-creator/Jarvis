import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../onnxRuntime', () => ({ configureOnnxRuntime: vi.fn(async () => ({})), withOrtLock: <T,>(task: () => Promise<T>) => task() }));

const {
  WhisperIncompleteError,
  WhisperLoadTimeoutError,
  configureTransformersEnv,
  createWhisperLoader,
  describeWhisperLoadError,
  describeWhisperProgress,
  flattenUnknownError,
} = await import('./pipelineLoader');

type ProgressCallback = (info: { status: string; progress?: number }) => void;

interface FakePipelineOptions {
  tokenizer?: boolean;
  processor?: boolean;
  /** Retarde la résolution de `pipeline()` (jamais si `Infinity`). */
  delayMs?: number;
  progress?: number[];
  text?: string;
}

function fakeTransformers(options: FakePipelineOptions = {}) {
  const env: Record<string, unknown> = { allowLocalModels: false, allowRemoteModels: true };
  const dispose = vi.fn(async () => undefined);
  const pipeline = vi.fn(
    async (_task: string, _model: string, opts: { progress_callback?: ProgressCallback }) => {
      for (const value of options.progress ?? [10, 55, 100]) {
        opts.progress_callback?.({ status: 'progress_total', progress: value });
      }
      if (options.delayMs === Infinity) await new Promise(() => undefined);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      const pipe = Object.assign(async () => ({ text: options.text ?? ' Bonjour. ' }), {
        tokenizer: options.tokenizer === false ? undefined : {},
        processor: options.processor === false ? null : { feature_extractor: {} },
        dispose,
      });
      return pipe;
    },
  );
  return { module: { env, pipeline } as never, env, pipeline, dispose };
}

function loaderWith(fake: ReturnType<typeof fakeTransformers>, overrides: Record<string, number> = {}) {
  let clock = 0;
  const loader = createWhisperLoader({
    importTransformers: async () => fake.module,
    configureRuntime: async () => undefined,
    runExclusive: (task) => task(),
    now: () => clock,
    loadTimeoutMs: overrides.loadTimeoutMs ?? 90_000,
    retryAfterMs: overrides.retryAfterMs ?? 30_000,
    transcribeTimeoutMs: overrides.transcribeTimeoutMs ?? 60_000,
  });
  return { loader, advance: (ms: number) => (clock += ms) };
}

describe('configureTransformersEnv', () => {
  it('lit le modèle comme modèle local via jarvis-oww, sans Hub ni Cache Storage', () => {
    const env: Record<string, unknown> = { allowLocalModels: false, allowRemoteModels: true, useBrowserCache: true };
    configureTransformersEnv(env as never);
    expect(env).toMatchObject({
      allowLocalModels: true,
      localModelPath: 'jarvis-oww://whisper/',
      allowRemoteModels: false,
      useBrowserCache: false,
      useWasmCache: false,
      useFS: false,
    });
  });
});

describe('chargement de Whisper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passe par des étapes nommées et finit « prêt », jamais sur un 100 % muet', async () => {
    const fake = fakeTransformers();
    const { loader } = loaderWith(fake);
    const seen: string[] = [];
    loader.subscribe((info) => seen.push(describeWhisperProgress(info)));
    await loader.getPipeline();
    expect(seen[0]).toBe('Démarrage de Whisper…');
    expect(seen).toContain('Lecture du modèle Whisper… 55 %');
    expect(seen).toContain('Initialisation de Whisper (moteur ONNX)…');
    expect(seen.at(-1)).toBe('Whisper prêt (local, hors ligne).');
    expect(seen.some((line) => /100\s?%/.test(line))).toBe(false);
    expect(fake.env).toMatchObject({ allowLocalModels: true, allowRemoteModels: false });
    expect(fake.pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'Xenova/whisper-small',
      expect.objectContaining({ device: 'wasm', dtype: 'q8' }),
    );
  });

  it('ne reste jamais bloqué : la création des sessions qui ne répond plus finit en erreur française', async () => {
    const fake = fakeTransformers({ delayMs: Infinity });
    const { loader } = loaderWith(fake);
    const statuses: string[] = [];
    loader.subscribe((info) => statuses.push(describeWhisperProgress(info)));
    const pending = loader.getPipeline();
    const assertion = expect(pending).rejects.toBeInstanceOf(WhisperLoadTimeoutError);
    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;
    const last = statuses.at(-1)!;
    expect(last).toMatch(/ne s'est pas chargé en 90 s/);
    expect(last).toMatch(/création des sessions ONNX/);
    expect(last).toMatch(/Tester la voix/);
  });

  it('refuse un pipeline sans tokenizer ni processeur (cas 0.4.10) et libère ses sessions', async () => {
    const fake = fakeTransformers({ tokenizer: false, processor: false });
    const { loader } = loaderWith(fake);
    const error = await loader.getPipeline().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhisperIncompleteError);
    expect((error as InstanceType<typeof WhisperIncompleteError>).missing).toEqual([
      'tokenizer.json',
      'tokenizer_config.json',
      'preprocessor_config.json',
    ]);
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(describeWhisperLoadError(error)).toMatch(/sans tokenizer\.json.*preprocessor_config\.json/);
  });

  it('ne relance pas un chargement à chaque appel après un échec, sauf forcé ou après le délai', async () => {
    const fake = fakeTransformers({ tokenizer: false });
    const { loader, advance } = loaderWith(fake);
    await loader.getPipeline().catch(() => undefined);
    await loader.getPipeline().catch(() => undefined);
    await loader.transcribe(new Float32Array(16000)).catch(() => undefined);
    expect(fake.pipeline).toHaveBeenCalledTimes(1);
    await loader.getPipeline({ force: true }).catch(() => undefined);
    expect(fake.pipeline).toHaveBeenCalledTimes(2);
    advance(30_001);
    await loader.getPipeline().catch(() => undefined);
    expect(fake.pipeline).toHaveBeenCalledTimes(3);
  });

  it('borne le nombre de jetons générés (boucle d’hallucination sur du bruit)', async () => {
    const fake = fakeTransformers();
    const calls: Array<Record<string, unknown>> = [];
    const pipe = Object.assign(async (_pcm: Float32Array, opts: Record<string, unknown>) => {
      calls.push(opts);
      return { text: 'ok' };
    }, { tokenizer: {}, processor: { feature_extractor: {} }, dispose: async () => undefined });
    fake.pipeline.mockImplementation(async () => pipe as never);
    const { loader } = loaderWith(fake);
    await loader.transcribe(new Float32Array(16000));
    await loader.transcribe(new Float32Array(16000), { language: 'english', maxNewTokens: 12 });
    expect(calls[0]).toMatchObject({ language: 'french', task: 'transcribe', max_new_tokens: 96 });
    expect(calls[1]).toMatchObject({ language: 'english', max_new_tokens: 12 });
  });

  it('partage un seul chargement entre dictée, mot de réveil et YouTube', async () => {
    const fake = fakeTransformers({ text: ' Quelle heure est-il ? ' });
    const { loader } = loaderWith(fake);
    const [a, b, c] = await Promise.all([
      loader.transcribe(new Float32Array(16000)),
      loader.transcribe(new Float32Array(16000), { language: 'english' }),
      loader.getPipeline(),
    ]);
    expect(a).toBe('Quelle heure est-il ?');
    expect(b).toBe('Quelle heure est-il ?');
    expect(typeof c).toBe('function');
    expect(fake.pipeline).toHaveBeenCalledTimes(1);
  });
});

describe('describeWhisperLoadError', () => {
  it('explique le tuple 99, 50, 24, 8 vu dans 0.4.8', () => {
    const message = describeWhisperLoadError('99, 50, 24, 8');
    expect(message).toMatch(/codes 99, 50, 24, 8/);
    expect(message).toMatch(/WebAssembly|ONNX/i);
  });

  it('aplatit un tableau numérique comme transformers/ORT le jette parfois', () => {
    expect(flattenUnknownError([99, 50, 24, 8])).toBe('99, 50, 24, 8');
  });

  it('traduit ERROR_CODE ONNX et le délai d’initialisation WebAssembly', () => {
    expect(describeWhisperLoadError(new Error("Can't create a session. ERROR_CODE: 6"))).toMatch(/code ONNX 6/);
    expect(
      describeWhisperLoadError(new Error('WebAssembly backend initializing failed due to timeout: 30000ms')),
    ).toMatch(/n'a pas démarré à temps/);
  });

  it('traduit un 404 de fichier embarqué', () => {
    expect(describeWhisperLoadError(new Error('HTTP 404 pour jarvis-oww://ort/x.wasm'))).toMatch(/HTTP 404/);
  });

  it('traduit les erreurs feature_extractor (0.4.9) et tokenizer_class (0.4.10)', () => {
    for (const raw of [
      "Cannot read properties of null (reading 'feature_extractor')",
      "Cannot read properties of undefined (reading 'tokenizer_class')",
    ]) {
      expect(describeWhisperLoadError(new TypeError(raw))).toMatch(/preprocessor_config\.json/);
    }
  });
});
