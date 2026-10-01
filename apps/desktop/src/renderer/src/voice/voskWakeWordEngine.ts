import {
  VOSK_MODEL_ARCHIVE,
  resampleLinear,
  voiceAssetUrl,
  voskGrammar,
  voskMinConfidence,
  voskWakeHits,
  voskWakeWindow,
  type VoskWord,
  type WakeWordEngine,
  type WakeWordEngineConfig,
  type WakeWordEngineController,
  type WakeWordEngineHandlers,
  type WakeWordWindow,
} from '@jarvis/core';

const SAMPLE_RATE = 16000;
/** Audio gardé pour la dictée : de quoi couvrir « Jarvis » + une phrase avant la fin d'énoncé de Vosk. */
const HISTORY_SECONDS = 15;
/** Premier lancement : import du module (~6 Mo), WebAssembly, extraction du modèle (~43 Mo) dans IndexedDB. */
export const VOSK_LOAD_TIMEOUT_MS = 120_000;
/** « Jarvis » entendu avec moins d'assurance : candidat que seul le vérificateur personnel peut accepter. */
export const VOSK_NEAR_MISS_CONFIDENCE = 0.5;

export interface VoskRecognizerLike {
  on(event: 'result' | 'partialresult' | 'error', listener: (message: unknown) => void): void;
  setWords(words: boolean): void;
  acceptWaveformFloat(buffer: Float32Array, sampleRate: number): void;
  retrieveFinalResult(): void;
  remove(): void;
}

export interface VoskModelLike {
  KaldiRecognizer: new (sampleRate: number, grammar?: string) => VoskRecognizerLike;
}

export type VoskModelLoader = () => Promise<VoskModelLike>;

function log(line: string): void {
  try {
    window.jarvis?.voice?.log?.(`[vosk] ${line}`);
  } catch {
    // Journal seulement.
  }
}

let sharedModel: Promise<VoskModelLike> | null = null;

/**
 * Un seul modèle Vosk (un Web Worker) pour toute l'application. Le module
 * vosk-browser n'est importé qu'ici, au premier besoin : la première frame
 * de la fenêtre ne l'attend pas.
 */
export function loadVoskModel(): Promise<VoskModelLike> {
  sharedModel ??= (async () => {
    const started = performance.now();
    const vosk = await import('vosk-browser');
    const model = await vosk.createModel(voiceAssetUrl('vosk', VOSK_MODEL_ARCHIVE));
    log(`modèle ${VOSK_MODEL_ARCHIVE} prêt en ${Math.round(performance.now() - started)} ms`);
    return model as unknown as VoskModelLike;
  })().catch((error: unknown) => {
    sharedModel = null;
    throw error;
  });
  return sharedModel;
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

/** Tampon circulaire indexé en échantillons absolus depuis le début de l'écoute. */
export class PcmHistory {
  private readonly buffer: Float32Array;
  private total = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Float32Array(capacity);
  }

  get totalSamples(): number {
    return this.total;
  }

  push(frame: Float32Array): void {
    for (let index = 0; index < frame.length; index += 1) {
      this.buffer[(this.total + index) % this.capacity] = frame[index]!;
    }
    this.total += frame.length;
  }

  /** Échantillons [from, to[ encore en mémoire (les plus anciens sont perdus). */
  slice(from: number, to: number): Float32Array {
    const start = Math.max(from, this.total - this.capacity, 0);
    const end = Math.min(to, this.total);
    const out = new Float32Array(Math.max(0, end - start));
    for (let index = 0; index < out.length; index += 1) {
      out[index] = this.buffer[(start + index) % this.capacity]!;
    }
    return out;
  }
}

function resultOf(message: unknown): unknown {
  return (message as { result?: unknown } | null)?.result ?? null;
}

/**
 * « Jarvis » seul, repéré par Vosk (modèle français, grammaire fermée avec
 * leurres, confiance ≥ 0,9 par défaut). Le décodage tourne dans le Web
 * Worker de vosk-browser : le fil principal ne fait que lui passer l'audio.
 * Whisper n'est plus lancé sur chaque rafale de parole.
 */
export class VoskWakeWordEngine implements WakeWordEngine {
  readonly id = 'vosk';
  readonly label = 'Vosk — « Jarvis » (français, local, sans clé)';
  readonly managesOwnCapture = false;

  constructor(
    private readonly config: WakeWordEngineConfig,
    private readonly loader: VoskModelLoader = loadVoskModel,
    private readonly loadTimeoutMs = VOSK_LOAD_TIMEOUT_MS,
  ) {}

  start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
    const word = this.config.keyword ?? 'jarvis';
    const minConfidence = voskMinConfidence(this.config.sensitivity ?? 0.7);
    const history = new PcmHistory(HISTORY_SECONDS * SAMPLE_RATE);
    let stopped = false;
    let failed = false;
    let loading: Promise<void> | null = null;
    let recognizer: VoskRecognizerLike | null = null;
    /** Index absolu (dans `history`) du premier échantillon donné au recognizer : l'origine des temps de Vosk. */
    let origin = 0;
    let lastWindow: WakeWordWindow | null = null;

    const fail = (error: unknown): void => {
      if (stopped || failed) return;
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      log(`indisponible : ${message}`);
      handlers.onError(`Vosk indisponible : ${message}`);
    };

    const onResult = (message: unknown): void => {
      if (stopped) return;
      const hits = voskWakeHits(resultOf(message), word, minConfidence);
      const hit: VoskWord | undefined = hits.at(-1);
      if (!hit) {
        const near = handlers.onNearMiss ? voskWakeHits(resultOf(message), word, VOSK_NEAR_MISS_CONFIDENCE).at(-1) : undefined;
        if (near && handlers.onNearMiss) {
          const heard = history.totalSamples - origin;
          const { startSample, commandOffset } = voskWakeWindow(near, heard, SAMPLE_RATE);
          log(`« ${near.word} » sous le seuil (confiance ${near.conf.toFixed(2)})`);
          handlers.onNearMiss(word, {
            pcm: history.slice(origin + startSample, history.totalSamples),
            sampleRate: SAMPLE_RATE,
            commandOffset,
          });
        }
        return;
      }
      const heard = history.totalSamples - origin;
      const { startSample, commandOffset } = voskWakeWindow(hit, heard, SAMPLE_RATE);
      lastWindow = {
        pcm: history.slice(origin + startSample, history.totalSamples),
        sampleRate: SAMPLE_RATE,
        commandOffset,
      };
      log(`« ${hit.word} » entendu (confiance ${hit.conf.toFixed(2)}, ${hit.start.toFixed(2)}–${hit.end.toFixed(2)} s)`);
      handlers.onDetected(word);
    };

    const ensureLoaded = (): void => {
      if (loading) return;
      loading = withTimeout(
        this.loader(),
        this.loadTimeoutMs,
        `chargement bloqué plus de ${Math.round(this.loadTimeoutMs / 1000)} s`,
      )
        .then((model) => {
          if (stopped) return;
          const created = new model.KaldiRecognizer(SAMPLE_RATE, JSON.stringify(voskGrammar(word)));
          created.setWords(true);
          created.on('result', onResult);
          created.on('error', (message) => fail(new Error(String((message as { error?: unknown }).error ?? message))));
          origin = history.totalSamples;
          recognizer = created;
          log(`écoute de « ${word} » (confiance ≥ ${minConfidence.toFixed(2)})`);
        })
        .catch(fail);
    };

    return {
      getLastAnalyzedWindow: () => lastWindow,
      pushAudio: (frame, sampleRate) => {
        if (stopped || failed) return;
        const pcm = sampleRate === SAMPLE_RATE ? frame : resampleLinear(frame, sampleRate, SAMPLE_RATE);
        history.push(pcm);
        ensureLoaded();
        recognizer?.acceptWaveformFloat(pcm, SAMPLE_RATE);
      },
      stop: () => {
        stopped = true;
        recognizer?.remove();
        recognizer = null;
      },
    };
  }
}

/**
 * Diagnostic et « Analyser un fichier audio » : même modèle, même
 * grammaire, sur un extrait entier. Renvoie toutes les occurrences sûres.
 */
export async function spotWakeWordInClip(
  pcm: Float32Array,
  sampleRate: number,
  config: { keyword: string; sensitivity: number },
  loader: VoskModelLoader = loadVoskModel,
): Promise<VoskWord[]> {
  const model = await loader();
  const recognizer = new model.KaldiRecognizer(SAMPLE_RATE, JSON.stringify(voskGrammar(config.keyword)));
  recognizer.setWords(true);
  const minConfidence = voskMinConfidence(config.sensitivity);
  const hits: VoskWord[] = [];
  const pcm16 = sampleRate === SAMPLE_RATE ? pcm : resampleLinear(pcm, sampleRate, SAMPLE_RATE);
  const tail = new Float32Array(SAMPLE_RATE);
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => finish(new Error('Vosk n’a pas rendu de résultat en 30 s')), 30_000);
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (quiet) clearTimeout(quiet);
      recognizer.remove();
      if (error) reject(error);
      else resolve();
    };
    // Les résultats intermédiaires et le résultat final ont le même type
    // d'événement ; le final est le dernier, les messages restant dans l'ordre.
    recognizer.on('result', (message) => {
      hits.push(...voskWakeHits(resultOf(message), config.keyword, minConfidence));
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(() => finish(), 400);
    });
    recognizer.on('error', (message) => finish(new Error(String((message as { error?: unknown }).error ?? message))));
    for (let offset = 0; offset < pcm16.length; offset += 4096) {
      recognizer.acceptWaveformFloat(pcm16.subarray(offset, Math.min(pcm16.length, offset + 4096)), SAMPLE_RATE);
    }
    recognizer.acceptWaveformFloat(tail, SAMPLE_RATE);
    recognizer.retrieveFinalResult();
  });
  return hits;
}
