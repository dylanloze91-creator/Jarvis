import type { AutomaticSpeechRecognitionPipeline, ProgressInfo } from '@huggingface/transformers';
import {
  WHISPER_DICTATION_LANGUAGE,
  WHISPER_LOCAL_MODEL_ROOT,
  WHISPER_MODEL_REPO,
} from '@jarvis/core';
import { configureOnnxRuntime, withOrtLock } from '../onnxRuntime';

/**
 * Chargement complet (runtime + lecture des fichiers + sessions ONNX)
 * au-delà duquel on abandonne avec une erreur qui nomme l'étape bloquée.
 * whisper-base q8 se charge en quelques secondes sur un i7 ; 90 s couvre
 * un PC lent sans jamais laisser « Chargement… » affiché indéfiniment.
 */
export const WHISPER_LOAD_TIMEOUT_MS = 90_000;
/**
 * Après un échec, les appels suivants reçoivent la même erreur pendant ce
 * délai au lieu de relancer 20 s de chargement à chaque mot de réveil.
 * « Préparer maintenant » et « Tester la voix » passent outre (`force`).
 */
export const WHISPER_RETRY_AFTER_MS = 30_000;
/** Une dictée dure au plus 12 s : une inférence plus longue est anormale. */
export const WHISPER_TRANSCRIBE_TIMEOUT_MS = 60_000;

export type WhisperLoadStage = 'runtime' | 'files' | 'session' | 'verify';

export const WHISPER_STAGE_LABEL: Record<WhisperLoadStage, string> = {
  runtime: 'démarrage du moteur ONNX (WebAssembly)',
  files: 'lecture des fichiers du modèle',
  session: 'création des sessions ONNX du modèle',
  verify: 'vérification du tokenizer et du processeur audio',
};

export interface WhisperLoadProgress {
  status: 'loading' | 'ready' | 'error';
  stage?: WhisperLoadStage;
  /** 0 à 100, uniquement pendant `files`. */
  progress?: number;
  message?: string;
  elapsedMs?: number;
}

export class WhisperLoadTimeoutError extends Error {
  constructor(
    readonly stage: WhisperLoadStage,
    readonly timeoutMs: number,
  ) {
    super(`whisper-load-timeout:${stage}:${timeoutMs}`);
    this.name = 'WhisperLoadTimeoutError';
  }
}

/** transformers.js a rendu un pipeline sans tokenizer ou sans processeur audio. */
export class WhisperIncompleteError extends Error {
  constructor(readonly missing: string[]) {
    super(`whisper-incomplete:${missing.join(',')}`);
    this.name = 'WhisperIncompleteError';
  }
}

export class WhisperTranscribeTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`whisper-transcribe-timeout:${timeoutMs}`);
    this.name = 'WhisperTranscribeTimeoutError';
  }
}

type Transformers = typeof import('@huggingface/transformers');
type LoadedPipeline = AutomaticSpeechRecognitionPipeline & {
  tokenizer?: unknown;
  processor?: { feature_extractor?: unknown } | null;
  dispose?: () => Promise<void>;
};

export interface WhisperLoaderDeps {
  importTransformers: () => Promise<Transformers>;
  configureRuntime: () => Promise<unknown>;
  /** Sérialise les appels au runtime ONNX partagé avec openWakeWord. */
  runExclusive: <T>(task: () => Promise<T>) => Promise<T>;
  now: () => number;
  loadTimeoutMs: number;
  retryAfterMs: number;
  transcribeTimeoutMs: number;
}

export interface TranscribeOptions {
  /** Nom complet de la langue attendu par Whisper (ex. "french"), pas un code ISO. */
  language?: string;
  /**
   * Plafond de jetons générés. Sur du bruit, Whisper boucle sur une phrase
   * jusqu'à 448 jetons (20 s sur ce type de CPU) : on borne selon l'usage.
   */
  maxNewTokens?: number;
}

/** Une dictée dure au plus 12 s : ~40 mots. */
export const DICTATION_MAX_NEW_TOKENS = 96;
/** « Jarvis » et un ou deux mots. */
export const WAKE_WORD_MAX_NEW_TOKENS = 12;
/** Une tranche YouTube de 30 s. */
export const YOUTUBE_MAX_NEW_TOKENS = 224;

/**
 * Configuration documentée de transformers.js pour un modèle embarqué :
 * modèles « locaux » lus sous `localModelPath`, Hub distant interdit, pas de
 * Cache Storage. Avec l'ancienne configuration (`remoteHost` = jarvis-oww,
 * `allowLocalModels = false`), transformers.js 4.x testait l'existence de
 * chaque fichier par une requête `Range` réservée à http(s) : tokenizer et
 * `preprocessor_config.json` passaient pour absents, d'où les erreurs
 * `feature_extractor` (0.4.9) puis `tokenizer_class` (0.4.10).
 */
export function configureTransformersEnv(env: Transformers['env']): void {
  env.allowLocalModels = true;
  env.localModelPath = WHISPER_LOCAL_MODEL_ROOT;
  env.allowRemoteModels = false;
  env.useBrowserCache = false;
  env.useWasmCache = false;
  env.useFS = false;
}

export function createWhisperLoader(deps: WhisperLoaderDeps) {
  const listeners = new Set<(info: WhisperLoadProgress) => void>();
  let current: Promise<LoadedPipeline> | null = null;
  let lastFailure: { error: unknown; at: number } | null = null;
  let lastProgress: WhisperLoadProgress | null = null;

  const emit = (info: WhisperLoadProgress): void => {
    lastProgress = info;
    for (const listener of listeners) listener(info);
  };

  const load = (): Promise<LoadedPipeline> => {
    const startedAt = deps.now();
    let stage: WhisperLoadStage = 'runtime';
    let timedOut = false;
    const setStage = (next: WhisperLoadStage, progress?: number): void => {
      stage = next;
      emit({ status: 'loading', stage, progress, elapsedMs: deps.now() - startedAt });
    };

    const run = async (): Promise<LoadedPipeline> => {
      setStage('runtime');
      await deps.configureRuntime();
      const transformers = await deps.importTransformers();
      configureTransformersEnv(transformers.env);
      setStage('files', 0);
      const pipe = (await deps.runExclusive(() => transformers.pipeline('automatic-speech-recognition', WHISPER_MODEL_REPO, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: (info: ProgressInfo) => {
          if (timedOut || info.status !== 'progress_total') return;
          const percent = Math.max(0, Math.min(100, info.progress ?? 0));
          if (percent >= 100) setStage('session');
          else if (stage === 'files') setStage('files', percent);
        },
      }))) as LoadedPipeline;
      if (timedOut) {
        void pipe.dispose?.();
        throw new WhisperLoadTimeoutError(stage, deps.loadTimeoutMs);
      }
      setStage('verify');
      const missing: string[] = [];
      if (!pipe.tokenizer) missing.push('tokenizer.json', 'tokenizer_config.json');
      if (!pipe.processor?.feature_extractor) missing.push('preprocessor_config.json');
      if (missing.length > 0) {
        await pipe.dispose?.().catch(() => undefined);
        throw new WhisperIncompleteError(missing);
      }
      return pipe;
    };

    return new Promise<LoadedPipeline>((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new WhisperLoadTimeoutError(stage, deps.loadTimeoutMs));
      }, deps.loadTimeoutMs);
      run().then(
        (pipe) => {
          clearTimeout(timer);
          resolve(pipe);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };

  const getPipeline = (options: { force?: boolean } = {}): Promise<LoadedPipeline> => {
    if (current) return current;
    if (lastFailure && !options.force && deps.now() - lastFailure.at < deps.retryAfterMs) {
      return Promise.reject(lastFailure.error);
    }
    lastFailure = null;
    const startedAt = deps.now();
    const attempt = load().then(
      (pipe) => {
        emit({ status: 'ready', elapsedMs: deps.now() - startedAt });
        return pipe;
      },
      (error: unknown) => {
        current = null;
        lastFailure = { error, at: deps.now() };
        emit({ status: 'error', message: describeWhisperLoadError(error), elapsedMs: deps.now() - startedAt });
        throw error;
      },
    );
    current = attempt;
    return attempt;
  };

  const transcribe = async (pcm: Float32Array, options: TranscribeOptions = {}): Promise<string> => {
    const pipe = await getPipeline();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new WhisperTranscribeTimeoutError(deps.transcribeTimeoutMs)),
        deps.transcribeTimeoutMs,
      );
    });
    try {
      const output = await Promise.race([
        deps.runExclusive(() =>
          pipe(pcm, {
            language: options.language ?? WHISPER_DICTATION_LANGUAGE,
            task: 'transcribe',
            chunk_length_s: 30,
            max_new_tokens: options.maxNewTokens ?? DICTATION_MAX_NEW_TOKENS,
          }),
        ),
        timeout,
      ]);
      const first = Array.isArray(output) ? output[0] : output;
      return (first as { text?: string } | undefined)?.text?.trim() ?? '';
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    getPipeline,
    transcribe,
    subscribe(listener: (info: WhisperLoadProgress) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lastProgress: (): WhisperLoadProgress | null => lastProgress,
    isReady: (): boolean => lastProgress?.status === 'ready',
  };
}

const defaultLoader = createWhisperLoader({
  importTransformers: () => import('@huggingface/transformers'),
  configureRuntime: () => configureOnnxRuntime(),
  runExclusive: withOrtLock,
  now: () => performance.now(),
  loadTimeoutMs: WHISPER_LOAD_TIMEOUT_MS,
  retryAfterMs: WHISPER_RETRY_AFTER_MS,
  transcribeTimeoutMs: WHISPER_TRANSCRIBE_TIMEOUT_MS,
});

/** Le seul Whisper de l'application : dictée, confirmation du mot de réveil, YouTube. */
export const getWhisperPipeline = defaultLoader.getPipeline;
export const transcribeWithWhisper = defaultLoader.transcribe;
export const subscribeWhisperProgress = defaultLoader.subscribe;
export const lastWhisperProgress = defaultLoader.lastProgress;

/** Texte de statut en français. Jamais « 100 % » tout seul : passé la lecture, on dit ce qui se passe. */
export function describeWhisperProgress(info: WhisperLoadProgress): string {
  if (info.status === 'error') return info.message ?? describeWhisperLoadError('erreur inconnue');
  if (info.status === 'ready') return 'Whisper prêt (local, hors ligne).';
  if (info.stage === 'files') {
    return `Lecture du modèle Whisper… ${Math.round(info.progress ?? 0)} %`;
  }
  if (info.stage === 'session' || info.stage === 'verify') {
    return 'Initialisation de Whisper (moteur ONNX)…';
  }
  return 'Démarrage de Whisper…';
}

/**
 * Messages d'erreur Whisper lisibles, en français. 0.4.8 affichait
 * « Transcription locale indisponible : 99, 50, 24, 8 » — un tuple numérique
 * d'onnxruntime / transformers.js, pas un id de modèle.
 */
export function flattenUnknownError(error: unknown): string {
  if (typeof error === 'number') return String(error);
  if (typeof error === 'string') return error;
  if (Array.isArray(error)) return error.map((item) => flattenUnknownError(item)).join(', ');
  if (error instanceof Error) {
    const cause = error.cause !== undefined ? ` (${flattenUnknownError(error.cause)})` : '';
    return `${error.message}${cause}`;
  }
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; code?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (typeof record.code === 'number' || typeof record.code === 'string') return String(record.code);
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

const NUMBER_LIST = /^\s*\d+(?:\s*,\s*\d+)+\s*$/;

export function describeWhisperLoadError(error: unknown): string {
  if (error instanceof WhisperLoadTimeoutError) {
    return (
      `Whisper ne s'est pas chargé en ${Math.round(error.timeoutMs / 1000)} s ` +
      `(bloqué à l'étape : ${WHISPER_STAGE_LABEL[error.stage]}). Lance « Tester la voix » dans les réglages.`
    );
  }
  if (error instanceof WhisperIncompleteError) {
    return (
      `Whisper s'est chargé sans ${error.missing.join(', ')} : transformers.js ne voit pas ces fichiers ` +
      'via jarvis-oww. Lance « Tester la voix » dans les réglages.'
    );
  }
  if (error instanceof WhisperTranscribeTimeoutError) {
    return `La transcription n'a pas abouti en ${Math.round(error.timeoutMs / 1000)} s.`;
  }

  const raw = flattenUnknownError(error).replace(/\s+/g, ' ').trim();
  if (!raw) return 'Transcription locale indisponible (erreur inconnue).';

  if (NUMBER_LIST.test(raw)) {
    return (
      `Le moteur Whisper n'a pas pu démarrer (codes ${raw}). ` +
      "Ce n'est pas un identifiant de modèle : le runtime WebAssembly ou un fichier ONNX embarqué est illisible."
    );
  }

  const ort = raw.match(/ERROR_CODE:\s*(\d+)/i)?.[1];
  if (ort) {
    return `Le modèle Whisper embarqué n'a pas pu être chargé (code ONNX ${ort}). Réinstalle Jarvis.`;
  }

  if (/initializing failed due to timeout/i.test(raw)) {
    return "Le moteur ONNX (WebAssembly) n'a pas démarré à temps. Lance « Tester la voix » dans les réglages.";
  }

  const http = raw.match(/\b(400|401|403|404|429|500|502|503|504)\b/)?.[1];
  if (/failed to fetch/i.test(raw) || http) {
    return `Fichier Whisper introuvable dans l'application${http ? ` (HTTP ${http})` : ''}. Réinstalle Jarvis.`;
  }

  if (/feature_extractor|tokenizer_class/.test(raw)) {
    return (
      'Fichiers du modèle Whisper non détectés (tokenizer ou preprocessor_config.json). ' +
      'Lance « Tester la voix » dans les réglages.'
    );
  }

  if (/not found|introuvable|enoent/i.test(raw)) {
    return "Les fichiers du modèle Whisper n'ont pas été trouvés dans l'installateur. Réinstalle Jarvis.";
  }

  const compact = raw.length > 140 ? `${raw.slice(0, 137)}…` : raw;
  return `Transcription locale indisponible : ${compact}`;
}
