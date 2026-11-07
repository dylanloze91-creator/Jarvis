/** Texte affiché au premier niveau (sans noms de moteurs). */
export const VOICE_WAKE_TEST_INTRO =
  'Dis « Hey Jarvis » ou « Jarvis » pour vérifier que Jarvis t’entend bien.';

export const VOICE_DIAGNOSTIC_INTRO =
  'Un test complet vérifie micro, réveil et dictée sur ce PC, sans envoyer d’audio ailleurs.';

export const FORBIDDEN_VOICE_SURFACE_TERMS = [
  'openWakeWord',
  'Vosk',
  'Whisper',
  'ONNX',
  'jarvis-oww',
] as const;
