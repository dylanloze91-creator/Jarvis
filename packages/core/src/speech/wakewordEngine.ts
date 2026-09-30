import { concatFloat32 } from './wav.js';
import {
  SpeechBurstDetector,
  WakeWordDetector,
  computeRms,
  type WakeWordDetectorConfig,
  type WakeWordMatchStrategy,
} from './wakeword.js';

/**
 * Abstraction de la détection du mot de réveil. La détection reste
 * *toujours* locale et hors ligne : openWakeWord (ONNX) et, à côté, le
 * gabarit d'énergie confirmé par Whisper pour un « Jarvis » nu.
 */

export interface WakeWordEngineHandlers {
  /** Le mot de réveil a été détecté. */
  onDetected: (keyword: string) => void;
  /** Score de confiance de la dernière trame analysée (0 à 1), pour un retour visuel pendant la calibration. */
  onScore?: (score: number) => void;
  onError: (message: string) => void;
}

/** Audio qui a déclenché le mot de réveil, transmis en préfixe à la dictée. */
export interface WakeWordWindow {
  pcm: Float32Array;
  sampleRate: number;
  /**
   * Index du premier échantillon postérieur au mot de réveil (arrivé pendant
   * sa confirmation) : pour la dictée, c'est déjà la commande.
   */
  commandOffset?: number;
}

/**
 * Découpe une fenêtre de réveil pour la dictée : `prefix` (le mot de réveil)
 * puis `command` (ce qui a suivi pendant la confirmation, parfois vide).
 */
export function splitWakeWordWindow(window: WakeWordWindow): { prefix: Float32Array; command: Float32Array } {
  const offset = Math.max(0, Math.min(window.pcm.length, window.commandOffset ?? window.pcm.length));
  return { prefix: window.pcm.subarray(0, offset), command: window.pcm.subarray(offset) };
}

export interface WakeWordEngineController {
  /**
   * Pousse une trame audio brute (PCM mono, amplitude normalisée [-1, 1]).
   * Absent ou à ignorer quand `managesOwnCapture` est vrai.
   */
  pushAudio?: (frame: Float32Array, sampleRate: number) => void;
  stop: () => void;
  /**
   * PCM (et son débit) de la dernière fenêtre analysée qui a déclenché la
   * détection, ou `null`. Permet à l'appelant de transmettre cet audio au
   * moteur de dictée comme préfixe : transcrire l'énoncé complet (mot de
   * réveil compris), puis retirer le mot de réveil du *texte* obtenu
   * (`stripLeadingWakeWord`), donne à Whisper plus de contexte qu'une
   * coupure de l'audio à l'instant précis de la détection.
   */
  getLastAnalyzedWindow?: () => WakeWordWindow | null;
}

export interface WakeWordEngine {
  readonly id: string;
  readonly label: string;
  /** `true` pour un moteur qui capture lui-même le micro ; `false` pour un moteur alimenté via `pushAudio`. */
  readonly managesOwnCapture: boolean;
  start: (handlers: WakeWordEngineHandlers) => WakeWordEngineController;
}

export interface WakeWordEngineConfig {
  /** Étiquette renvoyée à `onDetected`. */
  keyword?: string;
  /** Gabarits enregistrés par l'utilisateur (déclencheur par énergie). */
  detectorConfig?: WakeWordDetectorConfig | null;
  /** 0 (strict) à 1 (très sensible). */
  sensitivity?: number;
  /** Délai minimum entre deux déclenchements, en millisecondes. */
  cooldownMs?: number;
  /**
   * Variantes orthographiques supplémentaires du mot de réveil, en plus des
   * variantes intégrées (confirmation Whisper — voir `matchesWakeWord`).
   */
  variants?: string[];
}

export interface LocalTemplateWakeWordEngineOptions {
  /** Mot renvoyé à `onDetected` (juste une étiquette, la détection ne connaît pas le texte). */
  keyword: string;
  detectorConfig: WakeWordDetectorConfig | null;
  /** 0 (strict) à 1 (très sensible). */
  sensitivity: number;
}

export function createLocalTemplateWakeWordEngine(
  config: WakeWordEngineConfig,
): LocalTemplateWakeWordEngine {
  return new LocalTemplateWakeWordEngine({
    keyword: config.keyword ?? 'jarvis',
    detectorConfig: config.detectorConfig ?? null,
    sensitivity: config.sensitivity ?? 0.7,
  });
}

/**
 * Premier étage gratuit : enveloppe d'énergie (gabarit si des échantillons
 * existent, sinon une simple rafale de parole). Un second étage Whisper
 * (côté `apps/desktop`, via `wrapWakeWordEngineWithTranscriptConfirmation`)
 * confirme que l'énoncé est bien le mot de réveil. Sans cette confirmation,
 * ne comparer que des volumes dans le temps reste trop faible — d'où le
 * seuil volontairement permissif ici : trop de candidats, puis Whisper
 * écarte les faux positifs.
 */
export class LocalTemplateWakeWordEngine implements WakeWordEngine {
  readonly id = 'local-template';
  readonly label = 'Gabarit par énergie + confirmation Whisper';
  readonly managesOwnCapture = false;

  private readonly detector: WakeWordDetector;
  private burst: SpeechBurstDetector | null = null;

  constructor(private readonly engineOptions: LocalTemplateWakeWordEngineOptions) {
    this.detector = new WakeWordDetector(engineOptions.detectorConfig);
    this.detector.setSensitivity(engineOptions.sensitivity);
  }

  /**
   * Sans gabarit, un candidat = au moins `BURST_SPEECH_MS` de parole
   * continue, quelle que soit la taille des trames (4096 échantillons à
   * 16 kHz = 256 ms dans l'application). Compter des trames fixes (12)
   * exigeait 3 s de parole ininterrompue : un « Jarvis » seul (≈ 0,5 s dans
   * les prises de thedexios) ne passait jamais.
   */
  private burstFor(frameLength: number, sampleRate: number): SpeechBurstDetector {
    if (!this.burst) {
      const frameMs = (frameLength / sampleRate) * 1000;
      this.burst = new SpeechBurstDetector(
        Math.max(1, Math.round(BURST_SPEECH_MS / frameMs)),
        sensitivityToBurstEnergy(this.engineOptions.sensitivity),
        1500,
      );
    }
    return this.burst;
  }

  start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
    let chunks: Float32Array[] = [];
    let bufferedSamples = 0;
    let sampleRate = 16000;
    let lastAnalyzedWindow: { pcm: Float32Array; sampleRate: number } | null = null;
    // Horloge de l'audio, pas de l'ordinateur : identique en direct, et un
    // fichier analysé d'un bloc garde ses délais entre deux candidats.
    let audioMs = 0;
    /** Début (horloge audio) de la rafale qui a fait un candidat, en attente d'émission. */
    let pendingSince: number | null = null;

    return {
      getLastAnalyzedWindow: () => lastAnalyzedWindow,
      pushAudio: (frame, rate) => {
        sampleRate = rate;
        audioMs += (frame.length / rate) * 1000;
        chunks.push(frame);
        bufferedSamples += frame.length;
        const maxSamples = Math.round(rate * 1.6);
        while (bufferedSamples > maxSamples && chunks.length > 1) {
          const removed = chunks.shift()!;
          bufferedSamples -= removed.length;
        }

        const rms = computeRms(frame);
        // On émet quand la rafale se termine (tout le « Jarvis », même
        // traînant, est dans la fenêtre) ou au bout d'une seconde de parole
        // continue (« Jarvis, quelle heure est-il » enchaîné).
        if (pendingSince !== null) {
          const ended = rms < sensitivityToBurstEnergy(this.engineOptions.sensitivity);
          if (ended || audioMs - pendingSince >= BURST_MAX_WINDOW_MS) {
            pendingSince = null;
            lastAnalyzedWindow = { pcm: concatFloat32(chunks), sampleRate };
            handlers.onDetected(this.engineOptions.keyword);
          }
          return;
        }

        // Les gabarits s'ajoutent à la rafale, ils ne la remplacent pas : avec
        // les 7 prises de thedexios en gabarits, le gabarit seul ne proposait
        // plus qu'1 prise sur 7, la rafale 7 sur 7. Whisper confirme ensuite.
        if (this.detector.hasProfile()) {
          const templateHit = this.detector.pushEnergy(rms, audioMs);
          handlers.onScore?.(this.detector.getLastScore());
          if (templateHit) {
            lastAnalyzedWindow = { pcm: concatFloat32(chunks), sampleRate };
            handlers.onDetected(this.engineOptions.keyword);
            return;
          }
        }
        const burst = this.burstFor(frame.length, rate).push(rms, audioMs);
        if (!this.detector.hasProfile()) handlers.onScore?.(burst ? 1 : 0);
        if (burst) pendingSince = audioMs - BURST_SPEECH_MS;
      },
      stop: () => {
        pendingSince = null;
        this.detector.reset();
        this.burst?.reset();
        chunks = [];
        bufferedSamples = 0;
        lastAnalyzedWindow = null;
      },
    };
  }
}

const BURST_SPEECH_MS = 500;
const BURST_MAX_WINDOW_MS = 1000;

/** Plus la sensibilité est haute, plus une voix faible devient un candidat. */
function sensitivityToBurstEnergy(sensitivity: number): number {
  const clamped = Math.min(1, Math.max(0, sensitivity));
  const max = 0.028;
  const min = 0.008;
  return max - clamped * (max - min);
}

export type { WakeWordDetectorConfig, WakeWordMatchStrategy };
