import {
  createDefaultSttRegistry,
  createDefaultTtsRegistry,
  type Settings,
  type SpeechToTextRegistry,
  type TextToSpeechRegistry,
} from '@jarvis/core';
import type {
  VoiceSpeakInput,
  VoiceSpeakResult,
  VoiceTranscribeInput,
  VoiceTranscribeResult,
} from '../shared/ipc.js';

const OPENAI_STT_ID = 'openai-whisper';
const OPENAI_TTS_ID = 'openai-tts';

/**
 * Point d'entrée unique des appels vocaux qui ont besoin d'une clé API :
 * la reconnaissance et la synthèse locales (navigateur) ne passent jamais
 * par ici, elles restent entièrement dans le renderer. Ce module ne fait
 * que brancher les moteurs OpenAI de `@jarvis/core` sur l'IPC, exactement
 * comme `session.ts` le fait pour l'agent de conversation.
 */
export class VoiceBridge {
  private readonly sttRegistry: SpeechToTextRegistry = createDefaultSttRegistry();
  private readonly ttsRegistry: TextToSpeechRegistry = createDefaultTtsRegistry();

  constructor(private readonly getSettings: () => Settings) {}

  /** Clé utilisée pour la voix : celle dédiée si renseignée, sinon celle du fournisseur OpenAI du chat. */
  resolveApiKey(): string {
    const settings = this.getSettings();
    if (settings.voice.apiKey.trim()) return settings.voice.apiKey.trim();
    if (settings.provider === 'openai' && settings.apiKey.trim()) return settings.apiKey.trim();
    return '';
  }

  hasApiKey(): boolean {
    return this.resolveApiKey().length > 0;
  }

  async transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      return { ok: false, error: 'Clé API OpenAI manquante pour la reconnaissance vocale.' };
    }

    const provider = this.sttRegistry.create({ provider: OPENAI_STT_ID, apiKey });
    return new Promise((resolve) => {
      const controller = provider.start(
        {
          onFinal: (text) => resolve({ ok: true, text }),
          onError: (error) => resolve({ ok: false, error }),
        },
        { language: input.language },
      );
      controller.pushAudio?.(input.pcm, input.sampleRate);
      controller.stop();
    });
  }

  async speak(input: VoiceSpeakInput): Promise<VoiceSpeakResult> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      return { ok: false, error: 'Clé API OpenAI manquante pour la synthèse vocale.' };
    }

    const provider = this.ttsRegistry.create({ provider: OPENAI_TTS_ID, apiKey });
    return new Promise((resolve) => {
      provider.speak(
        input.text,
        {
          onAudio: (clip) => resolve({ ok: true, data: clip.data, mimeType: clip.mimeType }),
          onError: (error) => resolve({ ok: false, error }),
        },
        { voice: input.voice },
      );
    });
  }
}
