import { WHISPER_DICTATION_LANGUAGE, peakEnergy } from '@jarvis/core';
import type { SpeakerStatus, SpeakerTranscribeRequest } from '../../../shared/ipc';
import { DICTATION_MAX_NEW_TOKENS, getWhisperPipeline, holdWhisper, transcribeWithWhisper, type TranscribeOptions } from './whisper/pipelineLoader';

let installed = false;

export interface SpeakerWhisperDeps {
  transcribe: (pcm: Float32Array, options: TranscribeOptions) => Promise<string>;
  /** Charge le modèle sans rien transcrire : la première phrase d'une enceinte ne paie pas le réveil de Whisper. */
  warm: () => Promise<unknown>;
  /** Le garder chargé (le worker multi-thread, pas le chargeur de la page). */
  hold?: () => void;
  log?: (line: string) => void;
}

/** Whisper vaut la peine d'être chargé dès que le pont écoute réellement (interrupteur sur « on » et port ouvert). */
export function shouldWarmWhisper(status: Pick<SpeakerStatus, 'enabled' | 'running'> | null | undefined): boolean {
  return status?.enabled === true && status.running === true;
}

/**
 * 5.0.64 — les phrases des enceintes arrivent au processus principal (HTTP), mais Whisper vit
 * ici, dans la fenêtre. Même modèle, même langue (`french`) et mêmes corrections phonétiques que
 * la dictée : une phrase dite au salon est comprise comme une phrase dite au micro du PC.
 */
export function installSpeakerWhisperListener(): void {
  if (installed || !window.jarvis?.speaker) return;
  installed = true;
  createSpeakerWhisperBridge({
    transcribe: transcribeWithWhisper,
    warm: () => getWhisperPipeline(),
    hold: holdWhisper,
    log: (line) => console.info(line),
  });
}

/** Branche la fenêtre sur le pont des enceintes ; rend la fonction qui débranche (tests). */
export function createSpeakerWhisperBridge(deps: SpeakerWhisperDeps): () => void {
  const speaker = window.jarvis.speaker;
  let warming: Promise<unknown> | null = null;
  let warmed = false;
  const warmIfNeeded = (status: Pick<SpeakerStatus, 'enabled' | 'running'> | null | undefined): void => {
    if (warmed || warming || !shouldWarmWhisper(status)) return;
    deps.log?.('[enceinte] chargement de Whisper à l’avance (enceintes activées)');
    warming = deps
      .warm()
      .then(() => {
        warmed = true;
      })
      .catch((error: unknown) => {
        // Un prochain événement (interrupteur, phrase) redonnera sa chance ; la transcription, elle, réessaiera seule.
        deps.log?.(`[enceinte] Whisper n’a pas pu être chargé à l’avance : ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        warming = null;
      });
  };

  const offTranscribe = speaker.onTranscribe((request) => {
    void transcribeRequest(deps, request);
  });
  const offEvent = speaker.onEvent(warmIfNeeded);
  const offHold = speaker.onHoldWhisper?.(() => {
    deps.hold?.();
    deps.log?.('[enceinte] Whisper gardé chargé (worker)');
    warmIfNeeded({ enabled: true, running: true });
  }) ?? (() => undefined);
  void speaker
    .status()
    .then(warmIfNeeded)
    .catch(() => undefined);
  return () => {
    offTranscribe();
    offEvent();
    offHold();
  };
}

async function transcribeRequest(deps: SpeakerWhisperDeps, request: SpeakerTranscribeRequest): Promise<void> {
  const { requestId } = request;
  try {
    // L'IPC peut livrer un Float32Array déjà typé ou une vue brute : on se remet d'aplomb.
    const pcm =
      request.pcm instanceof Float32Array
        ? request.pcm
        : new Float32Array((request.pcm as { buffer: ArrayBuffer }).buffer ?? new ArrayBuffer(0));
    if (pcm.length === 0 || peakEnergy(pcm) < 0.005) {
      window.jarvis.speaker.reportTranscript({ requestId, text: '' });
      return;
    }
    const text = await deps.transcribe(pcm, {
      language: WHISPER_DICTATION_LANGUAGE,
      maxNewTokens: DICTATION_MAX_NEW_TOKENS,
    });
    window.jarvis.speaker.reportTranscript({ requestId, text: text.trim() });
  } catch (error) {
    window.jarvis.speaker.reportTranscript({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
