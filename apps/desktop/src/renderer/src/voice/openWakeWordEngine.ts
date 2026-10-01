import type * as Ort from 'onnxruntime-web';
import {
  OPENWAKEWORD_FRAME_SIZE,
  OPENWAKEWORD_MEL_BINS,
  OPENWAKEWORD_MEL_WINDOW,
  OPENWAKEWORD_SAMPLE_RATE,
  OpenWakeWordMelStream,
  CircularPcmBuffer,
  WakeTriggerGate,
  attenuateClipping,
  describeOpenWakeWordLoadError,
  openWakeWordSensitivityToThreshold,
  resampleLinear,
  scaleOpenWakeWordPcm,
  takeFixedFrames,
  voiceAssetUrl,
  type OpenWakeWordModelFile,
  type WakeWordEngine,
  type WakeWordEngineConfig,
  type WakeWordEngineController,
  type WakeWordEngineHandlers,
} from '@jarvis/core';
import { configureOnnxRuntime, withOrtLock } from './onnxRuntime';

const DEFAULT_EMBEDDING_WINDOW = 16;
const COOLDOWN_MS = 1800;
/** Chargement des 3 modèles (~4 Mo) : au-delà, erreur et repli, jamais une attente sans fin. */
export const OPENWAKEWORD_LOAD_TIMEOUT_MS = 30_000;
/** Un pic au-dessus de 60 % du seuil est un quasi-réveil (vérificateur personnel seulement). */
export const OPENWAKEWORD_NEAR_MISS_RATIO = 0.6;

export interface OpenWakeWordOnnxModels {
  ort: typeof Ort;
  mel: Ort.InferenceSession;
  embedding: Ort.InferenceSession;
  keyword: Ort.InferenceSession;
}

export type OpenWakeWordModelLoader = () => Promise<OpenWakeWordOnnxModels>;

export interface OpenWakeWordController extends WakeWordEngineController {
  /** Se résout quand toutes les trames déjà poussées ont été analysées. */
  idle: () => Promise<void>;
}

async function fetchModel(name: OpenWakeWordModelFile): Promise<ArrayBuffer> {
  const url = voiceAssetUrl('openwakeword', name);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} pour ${url}`);
  return response.arrayBuffer();
}

export async function loadOpenWakeWordModels(): Promise<OpenWakeWordOnnxModels> {
  const ort = await configureOnnxRuntime();
  const options = { executionProviders: ['wasm'] };
  const load = async (name: OpenWakeWordModelFile) => {
    const bytes = new Uint8Array(await fetchModel(name));
    return withOrtLock(() => ort.InferenceSession.create(bytes, options));
  };
  const [mel, embedding, keyword] = await Promise.all([
    load('melspectrogram.onnx'),
    load('embedding_model.onnx'),
    load('hey_jarvis_v0.1.onnx'),
  ]);
  return { ort, mel, embedding, keyword };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Pipeline openWakeWord (modèles ONNX officiels « hey_jarvis ») derrière
 * `WakeWordEngine`. Le micro reste dans `useVoice` : on reçoit du PCM, on
 * n'ouvre pas un second getUserMedia. Le modèle est pré-entraîné, on ne le
 * fine-tune pas.
 */
export class OpenWakeWordEngine implements WakeWordEngine {
  readonly id = 'openwakeword';
  readonly label = 'openWakeWord — Jarvis (gratuit, local, sans clé)';
  readonly managesOwnCapture = false;

  constructor(
    private readonly config: WakeWordEngineConfig,
    private readonly loadModels: OpenWakeWordModelLoader = loadOpenWakeWordModels,
    private readonly loadTimeoutMs = OPENWAKEWORD_LOAD_TIMEOUT_MS,
  ) {}

  start(handlers: WakeWordEngineHandlers): OpenWakeWordController {
    let stopped = false;
    let failed = false;
    let processing = Promise.resolve();
    let remainder = new Float32Array(0);
    const melStream = new OpenWakeWordMelStream();
    let lastAnalyzedWindow: { pcm: Float32Array; sampleRate: number } | null = null;
    const recentAudio = new CircularPcmBuffer(Math.round(OPENWAKEWORD_SAMPLE_RATE * 3));
    const triggerGate = new WakeTriggerGate(this.config.cooldownMs ?? COOLDOWN_MS);
    let loadPromise: Promise<OpenWakeWordOnnxModels> | null = null;
    let models: OpenWakeWordOnnxModels | null = null;
    let keywordWindowSize = DEFAULT_EMBEDDING_WINDOW;
    let embeddingHistory: Float32Array[] = [];
    let nearMiss: { score: number; pcm: Float32Array } | null = null;

    const resetRuntime = (windowSize: number): void => {
      keywordWindowSize = windowSize;
      melStream.reset();
      embeddingHistory = Array.from({ length: windowSize }, () => new Float32Array(96));
      triggerGate.reset();
    };

    const emitError = (error: unknown): void => {
      if (stopped || failed) return;
      failed = true;
      handlers.onError(`openWakeWord indisponible : ${describeOpenWakeWordLoadError(error)}`);
    };

    const ensureLoaded = async (): Promise<OpenWakeWordOnnxModels | null> => {
      if (models) return models;
      if (failed) return null;
      loadPromise ??= withTimeout(
        this.loadModels(),
        this.loadTimeoutMs,
        `chargement bloqué plus de ${Math.round(this.loadTimeoutMs / 1000)} s`,
      );
      try {
        const loaded = await loadPromise;
        if (!models) {
          models = loaded;
          resetRuntime(inferWindowSize(loaded.keyword) ?? DEFAULT_EMBEDDING_WINDOW);
        }
        return models;
      } catch (error) {
        emitError(error);
        return null;
      }
    };

    const runFrame = async (chunk: Float32Array): Promise<void> => {
      const loadedModels = await ensureLoaded();
      if (stopped || !loadedModels) return;
      await withOrtLock(() => analyzeFrame(loadedModels, chunk));
    };

    const analyzeFrame = async (loadedModels: OpenWakeWordOnnxModels, chunk: Float32Array): Promise<void> => {
      if (stopped) return;
      const { ort, mel, embedding, keyword } = loadedModels;

      // Même flux que `AudioFeatures` d'openWakeWord : 480 échantillons de
      // contexte, 8 trames mel par pas, un embedding par pas.
      const melInput = melStream.melInput(chunk);
      const melResults = await mel.run({
        [mel.inputNames[0]!]: new ort.Tensor('float32', melInput, [1, melInput.length]),
      });
      melStream.pushMel(melResults[mel.outputNames[0]!]!.data as Float32Array);

      const embeddingResult = await embedding.run({
        [embedding.inputNames[0]!]: new ort.Tensor('float32', melStream.embeddingWindow(), [
          1,
          OPENWAKEWORD_MEL_WINDOW,
          OPENWAKEWORD_MEL_BINS,
          1,
        ]),
      });
      const embeddingVector = new Float32Array(
        embeddingResult[embedding.outputNames[0]!]!.data as Float32Array,
      );
      embeddingHistory.shift();
      embeddingHistory.push(embeddingVector);

      const flattenedEmbeddings = new Float32Array(keywordWindowSize * 96);
      for (let i = 0; i < embeddingHistory.length; i += 1) {
        flattenedEmbeddings.set(embeddingHistory[i]!, i * 96);
      }
      const prediction = await keyword.run({
        [keyword.inputNames[0]!]: new ort.Tensor('float32', flattenedEmbeddings, [
          1,
          keywordWindowSize,
          96,
        ]),
      });
      const score = Number(prediction[keyword.outputNames[0]!]!.data[0] ?? 0);
      handlers.onScore?.(score);

      const threshold = openWakeWordSensitivityToThreshold(this.config.sensitivity ?? 0.7);
      const now = performance.now();
      if (score >= threshold && triggerGate.allow(now)) {
        nearMiss = null;
        lastAnalyzedWindow = {
          pcm: recentAudio.snapshot(),
          sampleRate: OPENWAKEWORD_SAMPLE_RATE,
        };
        handlers.onDetected(this.config.keyword ?? 'jarvis');
      } else if (handlers.onNearMiss && score < threshold) {
        // Pic sous le seuil : signalé quand le score retombe, avec l'audio du pic.
        const floor = threshold * OPENWAKEWORD_NEAR_MISS_RATIO;
        if (score >= floor && score > (nearMiss?.score ?? 0)) {
          nearMiss = { score, pcm: recentAudio.snapshot() };
        } else if (nearMiss && score < floor) {
          const peak = nearMiss;
          nearMiss = null;
          handlers.onNearMiss(this.config.keyword ?? 'jarvis', { pcm: peak.pcm, sampleRate: OPENWAKEWORD_SAMPLE_RATE });
        }
      }
    };

    return {
      idle: () => processing,
      getLastAnalyzedWindow: () => lastAnalyzedWindow,
      pushAudio: (frame, sampleRate) => {
        if (stopped || failed) return;
        const at16k =
          sampleRate === OPENWAKEWORD_SAMPLE_RATE
            ? frame
            : resampleLinear(frame, sampleRate, OPENWAKEWORD_SAMPLE_RATE);
        // Même signal que le niveau crête (16 kHz mono), sous le plein échelle.
        // Le mel reçoit ensuite l'échelle 16 bits, pas les flottants [-1, 1].
        const leveled = attenuateClipping(at16k).pcm;
        recentAudio.push(leveled);
        const model = scaleOpenWakeWordPcm(leveled);

        const split = takeFixedFrames(remainder, model, OPENWAKEWORD_FRAME_SIZE);
        remainder = new Float32Array(split.remainder);
        for (const chunk of split.chunks) {
          processing = processing.then(() => runFrame(chunk)).catch(emitError);
        }
      },
      stop: () => {
        stopped = true;
        remainder = new Float32Array(0);
        recentAudio.clear();
        melStream.reset();
        embeddingHistory = [];
      },
    };
  }
}

function inferWindowSize(session: Ort.InferenceSession): number | undefined {
  const metadata = session.inputMetadata as unknown;
  if (!metadata) return undefined;
  const first = Array.isArray(metadata) ? metadata[0] : undefined;
  const shape =
    first && typeof first === 'object' && first !== null && 'shape' in first
      ? (first as { shape?: Array<number | string> }).shape
      : undefined;
  const dimension = shape?.[1];
  return typeof dimension === 'number' && Number.isFinite(dimension) ? dimension : undefined;
}
