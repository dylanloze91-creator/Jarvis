/**
 * `lib.dom.d.ts` déclare les événements de la Web Speech API
 * (`SpeechRecognitionEvent`, `SpeechRecognitionResultList`…) mais pas
 * l'interface `SpeechRecognition` elle-même, ni son alias historique
 * `webkitSpeechRecognition` : cette déclaration complète le manque.
 */
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface Window {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}
