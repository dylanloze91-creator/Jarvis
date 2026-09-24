import {
  concatFloat32,
  findWhisperModel,
  peakEnergy,
  type SpeechProviderConfig,
  type SpeechToTextController,
  type SpeechToTextDescriptor,
  type SpeechToTextHandlers,
  type SpeechToTextProvider,
} from '@jarvis/core';
import { subscribeWhisperProgress, transcribeWithWhisper } from './whisper/pipelineLoader';

/**
 * Amplitude de crête minimale pour tenter une transcription, appliquée
 * seulement à l'audio arrivé après un éventuel préfixe (`markPrefixEnd`) —
 * jamais au préfixe lui-même, qui contient forcément de la parole (le mot
 * de réveil) et fausserait la mesure. Sans cette garde, un énoncé quasi
 * silencieux (l'utilisateur dit le mot de réveil puis ne dit rien) finirait
 * par être poussé à Whisper malgré tout — vérifié en pratique : Whisper
 * hallucine alors une phrase sans rapport en boucle (comportement connu du
 * modèle sur du bruit de fond pur). Autant ne rien transcrire dans ce cas :
 * `onFinal('')` est déjà traité comme « rien à dire » par l'appelant
 * (`useVoice.ts`).
 */
const MIN_UTTERANCE_PEAK_ENERGY = 0.02;

export const localWhisperSttDescriptor: SpeechToTextDescriptor = {
  id: 'local-whisper',
  label: 'Whisper local (gratuit, hors ligne après le premier téléchargement)',
  requiresApiKey: false,
};

/**
 * Moteur de dictée gratuit par défaut : Whisper tourne entièrement dans ce
 * processus (transformers.js, WebAssembly ou WebGPU — voir
 * `whisper/pipelineLoader.ts`), sans clé ni serveur. Remplace la
 * reconnaissance intégrée du navigateur (`browser-local`, retirée),
 * structurellement cassée dans Electron.
 *
 * Comme `OpenAISttProvider`, ce moteur ne capture pas lui-même le micro
 * (`managesOwnCapture = false`) : l'orchestrateur (`useVoice`) lui pousse
 * les trames PCM via `pushAudio`, déjà à 16 kHz — le débit attendu par
 * Whisper, aucun ré-échantillonnage nécessaire.
 */
export class LocalWhisperSttProvider implements SpeechToTextProvider {
  readonly id = localWhisperSttDescriptor.id;
  readonly label = localWhisperSttDescriptor.label;
  readonly requiresApiKey = false;
  readonly managesOwnCapture = false;

  private readonly repo: string;

  constructor(config: SpeechProviderConfig) {
    this.repo = findWhisperModel(config.model).repo;
  }

  start(
    handlers: SpeechToTextHandlers,
    options: { language?: string; signal?: AbortSignal } = {},
  ): SpeechToTextController {
    const frames: Float32Array[] = [];
    let prefixFrameCount = 0;
    let prefixMarked = false;
    let settled = false;

    return {
      pushAudio: (frame) => {
        if (settled) return;
        frames.push(frame);
      },
      markPrefixEnd: () => {
        prefixFrameCount = frames.length;
        prefixMarked = true;
      },
      stop: () => {
        if (settled) return;
        settled = true;
        void this.transcribe(frames, prefixMarked ? prefixFrameCount : 0, handlers, options);
      },
      abort: () => {
        settled = true;
      },
    };
  }

  private async transcribe(
    frames: Float32Array[],
    prefixFrameCount: number,
    handlers: SpeechToTextHandlers,
    options: { language?: string; signal?: AbortSignal },
  ): Promise<void> {
    if (frames.length === 0) {
      handlers.onError("Aucun son capturé avant la fin de l'écoute.");
      return;
    }

    const gateFrames = frames.slice(prefixFrameCount);
    const energyToCheck = gateFrames.length > 0 ? gateFrames : frames;
    if (peakEnergy(concatFloat32(energyToCheck)) < MIN_UTTERANCE_PEAK_ENERGY) {
      // Énoncé quasi silencieux (hors préfixe) : ne pas solliciter Whisper pour rien (coût CPU, et hallucinations connues sur du bruit).
      handlers.onFinal('');
      return;
    }

    const pcm = concatFloat32(frames);

    const unsubscribe = subscribeWhisperProgress((info) => {
      if (info.repo !== this.repo || info.status !== 'loading') return;
      const percent = Math.round(info.progress ?? 0);
      handlers.onPartial?.(
        info.message
          ? info.message
          : `Téléchargement du modèle Whisper (une seule fois)… ${percent}%`,
      );
    });

    try {
      const text = await transcribeWithWhisper(this.repo, pcm, {
        language: frenchNameOrDefault(options.language),
      });
      if (options.signal?.aborted) return;
      handlers.onFinal(text);
    } catch (error) {
      if (options.signal?.aborted) return;
      handlers.onError(describeError(error));
    } finally {
      unsubscribe();
    }
  }
}

/** Whisper attend un nom de langue complet (« french »), pas un code ISO (« fr-FR »). */
function frenchNameOrDefault(language: string | undefined): string {
  if (!language) return 'french';
  return language.toLowerCase().startsWith('fr') ? 'french' : language;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|network|Failed to fetch/i.test(message)) {
    return `Téléchargement du modèle Whisper impossible (vérifie la connexion réseau) : ${message}`;
  }
  return `Transcription locale indisponible : ${message}`;
}
