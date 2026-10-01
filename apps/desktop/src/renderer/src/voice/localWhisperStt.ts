import {
  WHISPER_DICTATION_LANGUAGE,
  concatFloat32,
  extendTrailingSilence,
  peakEnergy,
  speechDurationMs,
  type SpeechToTextController,
  type SpeechToTextDescriptor,
  type SpeechToTextHandlers,
  type SpeechToTextProvider,
} from '@jarvis/core';
import {
  describeWhisperLoadError,
  describeWhisperProgress,
  subscribeWhisperProgress,
  transcribeWithWhisper,
} from './whisper/pipelineLoader';

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
const SAMPLE_RATE = 16000;
const MIN_UTTERANCE_PEAK_ENERGY = 0.02;
/**
 * Après un mot de réveil, il faut au moins ça de parole pour transcrire :
 * la fin du mot (« …vis », jusqu'à une trame de 256 ms) déborde souvent
 * du préfixe. Sur « Jarvis » seul, Whisper écrivait sinon « J'arrive! »,
 * envoyé comme une commande.
 */
const MIN_COMMAND_SPEECH_MS = 300;

export const localWhisperSttDescriptor: SpeechToTextDescriptor = {
  id: 'local-whisper',
  label: 'Whisper local (gratuit, hors ligne, whisper-base embarqué)',
  requiresApiKey: false,
};

/**
 * Moteur de dictée gratuit par défaut : Whisper tourne entièrement dans ce
 * processus (transformers.js, WebAssembly — voir `whisper/pipelineLoader.ts`),
 * sans clé ni serveur ni CDN. Remplace la reconnaissance intégrée du
 * navigateur (`browser-local`, retirée), structurellement cassée dans Electron.
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
    const tooQuiet =
      prefixFrameCount > 0
        ? speechDurationMs(concatFloat32(gateFrames), SAMPLE_RATE) < MIN_COMMAND_SPEECH_MS
        : peakEnergy(concatFloat32(frames)) < MIN_UTTERANCE_PEAK_ENERGY;
    if (tooQuiet) {
      // Énoncé quasi silencieux (hors préfixe) : ne pas solliciter Whisper pour rien (coût CPU, et hallucinations connues sur du bruit).
      handlers.onFinal('');
      return;
    }

    // Fin de parole détectée après 650 ms de silence ; Whisper en reçoit ~1 s comme en 0.4.16.
    // Il complète de toute façon à 30 s (même coût) : couper le silence lui faisait perdre des mots.
    const pcm = extendTrailingSilence(concatFloat32(frames), SAMPLE_RATE);

    handlers.onPartial?.('Transcription…');
    const unsubscribe = subscribeWhisperProgress((info) => {
      if (info.status === 'loading') handlers.onPartial?.(describeWhisperProgress(info));
    });

    try {
      const started = performance.now();
      const text = await transcribeWithWhisper(pcm, {
        language: frenchNameOrDefault(options.language),
      });
      latencyLog(`[latence] whisper ${Math.round(performance.now() - started)} ms pour ${(pcm.length / SAMPLE_RATE).toFixed(2)} s d’audio`);
      if (options.signal?.aborted) return;
      handlers.onFinal(text);
    } catch (error) {
      if (options.signal?.aborted) return;
      handlers.onError(describeWhisperLoadError(error));
    } finally {
      unsubscribe();
    }
  }
}

function latencyLog(line: string): void {
  try {
    window.jarvis?.voice?.log?.(`[voix] ${line}`);
  } catch {
    // Journal seulement.
  }
}

/** Whisper attend un nom de langue complet (« french »), pas un code ISO (« fr-FR »). */
function frenchNameOrDefault(language: string | undefined): string {
  if (!language) return WHISPER_DICTATION_LANGUAGE;
  return language.toLowerCase().startsWith('fr') ? WHISPER_DICTATION_LANGUAGE : language;
}

