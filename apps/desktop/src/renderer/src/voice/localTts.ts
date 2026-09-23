import type {
  TextToSpeechController,
  TextToSpeechDescriptor,
  TextToSpeechHandlers,
  TextToSpeechProvider,
  VoiceDescriptor,
} from '@jarvis/core';

export const localTtsDescriptor: TextToSpeechDescriptor = {
  id: 'browser-local',
  label: 'Synthèse locale du système (gratuite, sans clé)',
  requiresApiKey: false,
};

/**
 * Adaptateur de `speechSynthesis` (voix du système, via Chromium) vers
 * `TextToSpeechProvider`. Ce moteur lit lui-même l'audio
 * (`managesOwnPlayback = true`) : l'appelant n'a rien d'autre à faire que
 * `stop()` pour couper la parole.
 */
export class LocalBrowserTtsProvider implements TextToSpeechProvider {
  readonly id = localTtsDescriptor.id;
  readonly label = localTtsDescriptor.label;
  readonly requiresApiKey = false;
  readonly managesOwnPlayback = true;

  async listVoices(): Promise<VoiceDescriptor[]> {
    const voices = await loadVoices();
    return voices.map((voice) => ({ id: voice.voiceURI, label: `${voice.name} (${voice.lang})` }));
  }

  speak(
    text: string,
    handlers: TextToSpeechHandlers,
    options: { voice?: string } = {},
  ): TextToSpeechController {
    if (!('speechSynthesis' in window)) {
      handlers.onError("La synthèse vocale n'est pas disponible ici.");
      return { stop: () => {} };
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';

    const voices = window.speechSynthesis.getVoices();
    const match = options.voice
      ? voices.find((voice) => voice.voiceURI === options.voice)
      : undefined;
    if (match) utterance.voice = match;

    utterance.onstart = () => handlers.onStart?.();
    utterance.onend = () => handlers.onEnd?.();
    utterance.onerror = (event) => handlers.onError(`Erreur de synthèse vocale : ${event.error}`);

    window.speechSynthesis.speak(utterance);

    return { stop: () => window.speechSynthesis.cancel() };
  }
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    const onVoicesChanged = (): void => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }, 800);
  });
}
