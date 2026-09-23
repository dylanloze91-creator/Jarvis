/**
 * Contrats de la couche vocale, au même titre que `LLMProvider` pour les
 * modèles de langage : le reste de l'application ne connaît que ces
 * interfaces, jamais une implémentation concrète. Changer de moteur de
 * reconnaissance ou de synthèse revient à écrire une classe et à
 * l'enregistrer dans le registre correspondant.
 *
 * Deux contraintes différencient ces interfaces de `LLMProvider` :
 * - certains moteurs (la reconnaissance et la synthèse embarquées du
 *   système/navigateur) capturent ou lisent l'audio eux-mêmes ; d'autres
 *   (les moteurs distants comme Whisper ou l'API de synthèse d'OpenAI)
 *   reçoivent l'audio en entrée et renvoient des octets en sortie. Les
 *   drapeaux `managesOwnCapture` / `managesOwnPlayback` indiquent lequel des
 *   deux cas s'applique, pour que l'appelant sache s'il doit lui pousser de
 *   l'audio ou simplement attendre des événements.
 * - l'audio brut est représenté par des types standards (`Float32Array`,
 *   `Uint8Array`) et non par des types DOM (`Blob`, `MediaStream`) : ce sont
 *   des types du langage, pas du navigateur, ce qui laisse ce fichier
 *   utilisable sans DOM, Node ou Electron.
 */

/** Bloc audio encodé (WAV, MP3…), tel qu'échangé avec les moteurs distants. */
export interface AudioClip {
  data: Uint8Array;
  mimeType: string;
}

export interface SpeechProviderConfig {
  provider: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export class SpeechProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SpeechProviderError';
  }
}

// ---------------------------------------------------------------------------
// Reconnaissance vocale (Speech-To-Text)
// ---------------------------------------------------------------------------

export interface SpeechToTextDescriptor {
  id: string;
  label: string;
  requiresApiKey: boolean;
  defaultModel?: string;
}

export interface SpeechToTextHandlers {
  /** Résultat intermédiaire, avant que l'utilisateur ait fini de parler. */
  onPartial?: (text: string) => void;
  /** Transcription définitive de la phrase. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

export interface SpeechToTextController {
  /**
   * Pousse un fragment audio brut (PCM mono, amplitude normalisée [-1, 1]).
   * Absent ou à ignorer quand `managesOwnCapture` est vrai : le moteur
   * capture alors son propre micro et cette méthode n'a pas d'effet.
   */
  pushAudio?: (frame: Float32Array, sampleRate: number) => void;
  /** Signale la fin de la phrase (silence détecté) et déclenche la transcription finale. */
  stop: () => void;
  /** Annule la session en cours sans produire de transcription. */
  abort: () => void;
}

export interface SpeechToTextProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresApiKey: boolean;
  /**
   * `true` pour les moteurs qui capturent eux-mêmes le micro (reconnaissance
   * embarquée du navigateur) ; `false` pour les moteurs qui attendent que
   * l'appelant leur fournisse l'audio via `pushAudio` (Whisper).
   */
  readonly managesOwnCapture: boolean;
  start: (
    handlers: SpeechToTextHandlers,
    options?: { language?: string; signal?: AbortSignal },
  ) => SpeechToTextController;
}

export type SpeechToTextFactory = (config: SpeechProviderConfig) => SpeechToTextProvider;

// ---------------------------------------------------------------------------
// Synthèse vocale (Text-To-Speech)
// ---------------------------------------------------------------------------

export interface TextToSpeechDescriptor {
  id: string;
  label: string;
  requiresApiKey: boolean;
  defaultModel?: string;
}

export interface VoiceDescriptor {
  id: string;
  label: string;
}

export interface TextToSpeechHandlers {
  onStart?: () => void;
  /** Fourni quand `managesOwnPlayback` est faux : l'appelant se charge de la lecture. */
  onAudio?: (clip: AudioClip) => void;
  onEnd?: () => void;
  onError: (message: string) => void;
}

export interface TextToSpeechController {
  /** Interrompt la synthèse ou la lecture en cours ("possibilité de couper"). */
  stop: () => void;
}

export interface TextToSpeechProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresApiKey: boolean;
  /**
   * `true` pour les moteurs qui lisent eux-mêmes l'audio (synthèse embarquée
   * du système) ; `false` pour les moteurs qui renvoient des octets à jouer
   * (API de synthèse d'OpenAI).
   */
  readonly managesOwnPlayback: boolean;
  listVoices: () => Promise<VoiceDescriptor[]>;
  speak: (
    text: string,
    handlers: TextToSpeechHandlers,
    options?: { voice?: string; signal?: AbortSignal },
  ) => TextToSpeechController;
}

export type TextToSpeechFactory = (config: SpeechProviderConfig) => TextToSpeechProvider;
