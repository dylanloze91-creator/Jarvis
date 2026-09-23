import {
  OPENAI_TTS_VOICES,
  concatFloat32,
  openAISttDescriptor,
  openAITtsDescriptor,
  type SpeechToTextController,
  type SpeechToTextHandlers,
  type SpeechToTextProvider,
  type TextToSpeechController,
  type TextToSpeechHandlers,
  type TextToSpeechProvider,
  type VoiceDescriptor,
} from '@jarvis/core';

/**
 * Ces deux classes implémentent les mêmes interfaces que les moteurs locaux,
 * mais délèguent le travail réel (et la clé API) au processus principal via
 * IPC : le renderer ne voit jamais la clé, seulement le résultat. C'est ce
 * qui permet à l'orchestrateur de la voix (`useVoice`) de traiter tous les
 * moteurs de façon uniforme, qu'ils soient locaux ou distants.
 */
export class IpcSttProvider implements SpeechToTextProvider {
  readonly id = openAISttDescriptor.id;
  readonly label = openAISttDescriptor.label;
  readonly requiresApiKey = true;
  readonly managesOwnCapture = false;

  start(
    handlers: SpeechToTextHandlers,
    options: { language?: string } = {},
  ): SpeechToTextController {
    const frames: Float32Array[] = [];
    let sampleRate = 16000;
    let settled = false;

    return {
      pushAudio: (frame, rate) => {
        if (settled) return;
        sampleRate = rate;
        frames.push(frame);
      },
      stop: () => {
        if (settled) return;
        settled = true;
        const pcm = concatFloat32(frames);
        void window.jarvis.voice
          .transcribe({ pcm, sampleRate, language: options.language })
          .then((result) => {
            if (result.ok) handlers.onFinal(result.text);
            else handlers.onError(result.error);
          })
          .catch((error: unknown) => handlers.onError(describeError(error)));
      },
      abort: () => {
        settled = true;
      },
    };
  }
}

export class IpcTtsProvider implements TextToSpeechProvider {
  readonly id = openAITtsDescriptor.id;
  readonly label = openAITtsDescriptor.label;
  readonly requiresApiKey = true;
  readonly managesOwnPlayback = false;

  async listVoices(): Promise<VoiceDescriptor[]> {
    return OPENAI_TTS_VOICES;
  }

  speak(
    text: string,
    handlers: TextToSpeechHandlers,
    options: { voice?: string } = {},
  ): TextToSpeechController {
    let cancelled = false;
    handlers.onStart?.();

    void window.jarvis.voice
      .speak({ text, voice: options.voice })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          handlers.onAudio?.({ data: result.data, mimeType: result.mimeType });
          handlers.onEnd?.();
        } else {
          handlers.onError(result.error);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) handlers.onError(describeError(error));
      });

    return {
      stop: () => {
        cancelled = true;
      },
    };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
