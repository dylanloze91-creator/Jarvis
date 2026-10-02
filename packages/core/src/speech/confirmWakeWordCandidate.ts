import {
  isWhisperHallucination,
  matchesWakeWord,
  type WakeWordTextMatchConfig,
} from './wakeWordTextMatch.js';
import type { TranscribeWindow } from './wakeWordFromTranscript.js';
import { concatFloat32 } from './wav.js';
import type {
  WakeWordEngine,
  WakeWordEngineController,
  WakeWordEngineHandlers,
  WakeWordWindow,
} from './wakewordEngine.js';

/**
 * Second étage du mot de réveil : un candidat (gabarit d'énergie ou rafale)
 * n'est accepté que si Whisper (injecté, jamais appelé ici) transcrit un
 * énoncé qui ressemble à « Jarvis » — y compris les variantes françaises
 * connues. Pur et testable : `transcribe` est un argument, pas un modèle.
 */
export interface ConfirmWakeWordCandidateInput {
  pcm: Float32Array;
  sampleRate: number;
}

export interface ConfirmWakeWordCandidateResult {
  confirmed: boolean;
  transcript: string | null;
  /** Vrai si `transcribe` a levé : l'appelant décide alors d'accepter ou non le candidat. */
  transcriptionFailed: boolean;
}

/**
 * `transcribe` d'abord (anglais : « Jarvis »), puis, s'il ne reconnaît pas
 * le mot, `secondOpinion` (français : « J'avis », « Javis ») sur la même
 * fenêtre. Sur les prises de thedexios, l'anglais seul hallucinait
 * « Thank you. » / « you » là où le français entendait « J'avis ».
 */
export async function confirmWakeWordCandidate(
  candidate: ConfirmWakeWordCandidateInput,
  transcribe: TranscribeWindow,
  matchConfig: WakeWordTextMatchConfig,
  secondOpinion?: TranscribeWindow,
): Promise<ConfirmWakeWordCandidateResult> {
  try {
    const transcript = await transcribe(candidate.pcm, candidate.sampleRate);
    const firstOk = !isWhisperHallucination(transcript) && matchesWakeWord(transcript, matchConfig);
    if (firstOk || !secondOpinion) {
      return { confirmed: firstOk, transcript, transcriptionFailed: false };
    }
    const second = await secondOpinion(candidate.pcm, candidate.sampleRate);
    const secondOk = !isWhisperHallucination(second) && matchesWakeWord(second, matchConfig);
    return {
      confirmed: secondOk,
      transcript: `${transcript} / ${second}`,
      transcriptionFailed: false,
    };
  } catch {
    return { confirmed: false, transcript: null, transcriptionFailed: true };
  }
}

export interface TranscriptConfirmationOptions {
  transcribe: TranscribeWindow;
  /** Second essai si `transcribe` ne reconnaît pas le mot (autre langue). */
  secondOpinion?: TranscribeWindow;
  word: string;
  variants?: string[];
  /**
   * Si Whisper est indisponible, accepter quand même le candidat d'énergie
   * plutôt que de rendre le mot de réveil muet. Les faux positifs Whisper
   * (transcription réussie mais texte sans rapport) restent rejetés.
   */
  acceptOnTranscriptionError?: boolean;
}

/**
 * Enveloppe n'importe quel moteur de premier étage : `onDetected` n'est
 * relayé que si la fenêtre PCM (`getLastAnalyzedWindow`) passe la
 * confirmation Whisper. Sans fenêtre, le candidat est relayé tel quel.
 */
export function wrapWakeWordEngineWithTranscriptConfirmation(
  inner: WakeWordEngine,
  options: TranscriptConfirmationOptions,
): WakeWordEngine {
  return {
    get id() {
      return inner.id;
    },
    get label() {
      return inner.label;
    },
    get managesOwnCapture() {
      return inner.managesOwnCapture;
    },
    start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
      let confirming = false;
      let stopped = false;
      // Ce qui arrive pendant que Whisper confirme (« …quelle heure est-il »)
      // n'est pas jeté : il devient le début de la commande.
      let held: Float32Array[] = [];
      let confirmedWindow: WakeWordWindow | null = null;
      const matchConfig: WakeWordTextMatchConfig = {
        word: options.word,
        variants: options.variants,
      };

      let controller!: WakeWordEngineController;
      // eslint-disable-next-line prefer-const -- les rappels ci-dessous lisent controller ; chemin du réveil laissé tel quel.
      controller = inner.start({
        onScore: handlers.onScore,
        onError: handlers.onError,
        onDetected: (keyword) => {
          if (stopped || confirming) return;
          const analyzed = controller.getLastAnalyzedWindow?.();
          if (!analyzed) {
            confirmedWindow = null;
            handlers.onDetected(keyword);
            return;
          }
          confirming = true;
          held = [];
          void confirmWakeWordCandidate(analyzed, options.transcribe, matchConfig, options.secondOpinion)
            .then((result) => {
              if (stopped) return;
              const accept =
                result.confirmed ||
                (result.transcriptionFailed && options.acceptOnTranscriptionError === true);
              handlers.onScore?.(accept ? 1 : 0);
              if (!accept) return;
              confirmedWindow = {
                pcm: concatFloat32([analyzed.pcm, ...held]),
                sampleRate: analyzed.sampleRate,
                commandOffset: analyzed.pcm.length,
              };
              handlers.onDetected(keyword);
            })
            .finally(() => {
              confirming = false;
              held = [];
            });
        },
      });

      return {
        getLastAnalyzedWindow: () => confirmedWindow ?? controller.getLastAnalyzedWindow?.() ?? null,
        pushAudio: (frame, rate) => {
          if (stopped) return;
          if (confirming) {
            held.push(frame);
            return;
          }
          controller.pushAudio?.(frame, rate);
        },
        stop: () => {
          stopped = true;
          held = [];
          controller.stop();
        },
      };
    },
  };
}
