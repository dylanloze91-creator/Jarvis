import {
  WHISPER_DICTATION_LANGUAGE,
  joinTimedParts,
  peakEnergy,
  type TimedTranscriptPart,
} from '@jarvis/core';
import { VOICE_SAMPLE_RATE, decodeAudioToMono16k } from './audioDecode';
import { YOUTUBE_MAX_NEW_TOKENS, transcribeWithWhisper } from './whisper/pipelineLoader';

const SAMPLE_RATE = VOICE_SAMPLE_RATE;
const CHUNK_SECONDS = 30;
const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS;

let installed = false;

/**
 * Reçoit la piste audio (pas la vidéo) et la fait écouter par le même
 * Whisper local que la dictée et le mot de réveil. N'entraîne pas le modèle et ne touche
 * pas au mot de réveil.
 */
export function installYoutubeWhisperListener(): void {
  if (installed || !window.jarvis?.youtube) return;
  installed = true;
  window.jarvis.youtube.onTranscribe((request) => {
    void transcribeRequest(request);
  });
}

async function transcribeRequest(request: { requestId: string; bytes: Uint8Array }): Promise<void> {
  const report = (message: string): void => {
    window.jarvis.youtube.reportProgress({ requestId: request.requestId, message });
  };
  try {
    report("Décodage de l'audio…");
    const pcm = await decodeAudioToMono16k(request.bytes);
    if (pcm.length === 0 || peakEnergy(pcm) < 0.005) {
      window.jarvis.youtube.reportResult({
        requestId: request.requestId,
        ok: false,
        error: 'piste audio silencieuse',
      });
      return;
    }
    const total = Math.ceil(pcm.length / CHUNK_SAMPLES);
    const parts: TimedTranscriptPart[] = [];
    for (let index = 0; index < total; index += 1) {
      report(`Écoute de la vidéo, partie ${index + 1} sur ${total}…`);
      const start = index * CHUNK_SAMPLES;
      const slice = pcm.subarray(start, Math.min(pcm.length, (index + 1) * CHUNK_SAMPLES));
      if (slice.length < SAMPLE_RATE / 2) continue;
      const text = await transcribeWithWhisper(slice, {
        language: WHISPER_DICTATION_LANGUAGE,
        maxNewTokens: YOUTUBE_MAX_NEW_TOKENS,
      });
      if (text.trim()) {
        parts.push({
          startSeconds: start / SAMPLE_RATE,
          endSeconds: (start + slice.length) / SAMPLE_RATE,
          text: text.trim(),
        });
      }
    }
    const transcript = joinTimedParts(parts);
    if (!transcript) {
      window.jarvis.youtube.reportResult({
        requestId: request.requestId,
        ok: false,
        error: 'Whisper n’a rien transcrit',
      });
      return;
    }
    window.jarvis.youtube.reportResult({
      requestId: request.requestId,
      ok: true,
      text: transcript,
    });
  } catch (error) {
    window.jarvis.youtube.reportResult({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
