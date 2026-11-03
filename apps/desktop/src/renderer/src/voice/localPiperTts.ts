import {
  PIPER_TTS_ID,
  listPiperVoiceDescriptors,
  localPiperTtsDescriptor,
  playPiperPartsWithPrefetch,
  shouldStreamPiperSpeech,
  splitFrenchSentences,
  type TextToSpeechController,
  type TextToSpeechHandlers,
  type TextToSpeechProvider,
  type VoiceDescriptor,
} from '@jarvis/core';

export { localPiperTtsDescriptor };

/**
 * Synthèse Piper via le processus principal (binaire séparé, texte sur stdin).
 * Lecture gérée ici (`managesOwnPlayback`) pour enchaîner les phrases une par une.
 */
export class LocalPiperTtsProvider implements TextToSpeechProvider {
  readonly id = localPiperTtsDescriptor.id;
  readonly label = localPiperTtsDescriptor.label;
  readonly requiresApiKey = false;
  readonly managesOwnPlayback = true;

  private activeAudio: HTMLAudioElement | null = null;

  async listVoices(): Promise<VoiceDescriptor[]> {
    return listPiperVoiceDescriptors();
  }

  speak(
    text: string,
    handlers: TextToSpeechHandlers,
    options: { voice?: string } = {},
  ): TextToSpeechController {
    let cancelled = false;
    handlers.onStart?.();

    void this.render(text, options.voice, handlers, () => cancelled).catch((error: unknown) => {
      if (!cancelled) handlers.onError(error instanceof Error ? error.message : String(error));
    });

    return {
      stop: () => {
        cancelled = true;
        if (this.activeAudio) {
          this.activeAudio.pause();
          this.activeAudio.src = '';
          this.activeAudio = null;
        }
      },
    };
  }

  private async render(
    text: string,
    voice: string | undefined,
    handlers: TextToSpeechHandlers,
    cancelled: () => boolean,
  ): Promise<void> {
    const status = await window.jarvis.voice.piperStatus();
    if (cancelled()) return;
    if (!status.ready) {
      handlers.onError('Voix Piper indisponible : lance « Tester la voix » ou réinstalle les fichiers voix.');
      return;
    }
    const stream = shouldStreamPiperSpeech(text, status.benchmarkMs);
    const parts = stream ? splitFrenchSentences(text) : [text];
    await playPiperPartsWithPrefetch(
      parts,
      (part) => window.jarvis.voice.piperSpeak({ text: part, voice, sentence: true }),
      (data, mimeType) => this.play(data, mimeType, cancelled),
      cancelled,
    );
    if (!cancelled()) handlers.onEnd?.();
  }

  private play(data: Uint8Array, mimeType: string, cancelled: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      if (cancelled()) {
        resolve();
        return;
      }
      const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.activeAudio = audio;
      const finish = (): void => {
        URL.revokeObjectURL(url);
        if (this.activeAudio === audio) this.activeAudio = null;
        resolve();
      };
      audio.addEventListener('ended', finish);
      audio.addEventListener('error', finish);
      void audio.play().catch(finish);
    });
  }
}

export function isLocalPiperProvider(id: string): boolean {
  return id === PIPER_TTS_ID;
}
