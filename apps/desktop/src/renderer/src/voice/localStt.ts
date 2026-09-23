import type {
  SpeechToTextController,
  SpeechToTextDescriptor,
  SpeechToTextHandlers,
  SpeechToTextProvider,
} from '@jarvis/core';

export const localSttDescriptor: SpeechToTextDescriptor = {
  id: 'browser-local',
  label: 'Reconnaissance locale du navigateur (gratuite, sans clé)',
  requiresApiKey: false,
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * Adaptateur de la Web Speech API vers `SpeechToTextProvider`. Ce moteur
 * capture son propre micro (`managesOwnCapture = true`) : l'orchestrateur ne
 * lui pousse jamais d'audio, il se contente d'appeler `stop()` quand le
 * silence est détecté.
 *
 * Limite connue : Electron ne fournit pas de clé Google API par défaut, ce
 * qui peut empêcher la reconnaissance de fonctionner selon la version — un
 * repli attendu de ce module est de signaler clairement l'erreur plutôt que
 * de rester silencieux.
 */
export class LocalBrowserSttProvider implements SpeechToTextProvider {
  readonly id = localSttDescriptor.id;
  readonly label = localSttDescriptor.label;
  readonly requiresApiKey = false;
  readonly managesOwnCapture = true;

  start(
    handlers: SpeechToTextHandlers,
    options: { language?: string } = {},
  ): SpeechToTextController {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      handlers.onError("La reconnaissance vocale du navigateur n'est pas disponible ici.");
      return { stop: () => {}, abort: () => {} };
    }

    const recognition = new Ctor();
    recognition.lang = options.language ?? 'fr-FR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results.item(index);
        const transcript = result.item(0).transcript;
        if (result.isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (interim.trim()) handlers.onPartial?.(interim.trim());
      if (finalText.trim()) handlers.onFinal(finalText.trim());
    };
    recognition.onerror = (event) => handlers.onError(describeSpeechError(event.error));

    try {
      recognition.start();
    } catch (error) {
      handlers.onError(error instanceof Error ? error.message : String(error));
    }

    return {
      stop: () => recognition.stop(),
      abort: () => recognition.abort(),
    };
  }
}

function describeSpeechError(error: string): string {
  switch (error) {
    case 'no-speech':
      return 'Aucune parole détectée.';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Accès au microphone refusé par le système.';
    case 'network':
      return 'La reconnaissance vocale locale du navigateur nécessite un service indisponible ici (limite connue d’Electron sans clé Google API).';
    default:
      return `Erreur de reconnaissance vocale : ${error}`;
  }
}
