import { WHISPER_DICTATION_LANGUAGE, peakEnergy } from '@jarvis/core';
import { DICTATION_MAX_NEW_TOKENS, transcribeWithWhisper } from './whisper/pipelineLoader';

let installed = false;

/**
 * 5.0.64 — les phrases des enceintes arrivent au processus principal (HTTP), mais Whisper vit
 * ici, dans la fenêtre. Même modèle, même langue (`french`) et mêmes corrections phonétiques que
 * la dictée : une phrase dite au salon est comprise comme une phrase dite au micro du PC.
 */
export function installSpeakerWhisperListener(): void {
  if (installed || !window.jarvis?.speaker) return;
  installed = true;
  window.jarvis.speaker.onTranscribe((request) => {
    void transcribeRequest(request);
  });
}

async function transcribeRequest(request: { requestId: string; pcm: Float32Array }): Promise<void> {
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
    const text = await transcribeWithWhisper(pcm, {
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
