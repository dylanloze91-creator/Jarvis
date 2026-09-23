import {
  WakeWordDetector,
  computeRms,
  type WakeWordDetectorConfig,
  type WakeWordMatchStrategy,
} from './wakeword.js';

/**
 * Abstraction de la détection du mot de réveil, au même titre que
 * `SpeechToTextProvider` et `TextToSpeechProvider` : le reste de
 * l'application ne connaît que cette interface. Elle reste distincte des
 * deux autres car la détection doit *toujours* rester locale et hors ligne —
 * il n'y a pas de repli « cloud » possible ici, seulement des moteurs locaux
 * de qualité différente (le gabarit maison, ou un moteur tiers comme
 * Porcupine).
 */
export interface WakeWordEngineDescriptor {
  id: string;
  label: string;
  requiresApiKey: boolean;
}

export interface WakeWordEngineHandlers {
  /** Le mot de réveil a été détecté. */
  onDetected: (keyword: string) => void;
  /** Score de confiance de la dernière trame analysée (0 à 1), pour un retour visuel pendant la calibration. */
  onScore?: (score: number) => void;
  onError: (message: string) => void;
}

export interface WakeWordEngineController {
  /**
   * Pousse une trame audio brute (PCM mono, amplitude normalisée [-1, 1]).
   * Absent ou à ignorer quand `managesOwnCapture` est vrai.
   */
  pushAudio?: (frame: Float32Array, sampleRate: number) => void;
  stop: () => void;
}

export interface WakeWordEngine {
  readonly id: string;
  readonly label: string;
  readonly requiresApiKey: boolean;
  /** `true` pour un moteur qui capture lui-même le micro ; `false` pour un moteur alimenté via `pushAudio`. */
  readonly managesOwnCapture: boolean;
  start: (handlers: WakeWordEngineHandlers) => WakeWordEngineController;
}

/**
 * Configuration passée à `create()`. `apiKey` est le seul champ générique
 * (comme pour les autres registres) ; les champs suivants sont spécifiques
 * au moteur local par gabarit — un moteur distant comme Porcupine les
 * ignore simplement.
 */
export interface WakeWordEngineConfig {
  provider: string;
  apiKey?: string;
  /** Étiquette renvoyée à `onDetected` (moteur local uniquement). */
  keyword?: string;
  /** Gabarits enregistrés par l'utilisateur (moteur local uniquement). */
  detectorConfig?: WakeWordDetectorConfig | null;
  /** 0 (strict) à 1 (très sensible) (moteur local uniquement). */
  sensitivity?: number;
}

export type WakeWordEngineFactory = (config: WakeWordEngineConfig) => WakeWordEngine;

export const localTemplateWakeWordDescriptor: WakeWordEngineDescriptor = {
  id: 'local-template',
  label: 'Gabarit local (gratuit, sans clé)',
  requiresApiKey: false,
};

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
    sensitivity: config.sensitivity ?? 0.5,
  });
}

/**
 * Implémentation par défaut de `WakeWordEngine` : enveloppe `WakeWordDetector`
 * (comparaison d'énergie à un ou plusieurs gabarits enregistrés localement).
 * Entièrement pur — pas de DOM, pas de micro — car l'audio lui est fourni
 * par l'appelant via `pushAudio`. C'est le moteur par défaut de
 * l'application : gratuit, sans compte, sans calibration imposée par un
 * tiers.
 */
export class LocalTemplateWakeWordEngine implements WakeWordEngine {
  readonly id = localTemplateWakeWordDescriptor.id;
  readonly label = localTemplateWakeWordDescriptor.label;
  readonly requiresApiKey = false;
  readonly managesOwnCapture = false;

  private readonly detector: WakeWordDetector;

  constructor(private readonly engineOptions: LocalTemplateWakeWordEngineOptions) {
    this.detector = new WakeWordDetector(engineOptions.detectorConfig);
    this.detector.setSensitivity(engineOptions.sensitivity);
  }

  start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
    return {
      pushAudio: (frame) => {
        const rms = computeRms(frame);
        const detected = this.detector.pushEnergy(rms);
        handlers.onScore?.(this.detector.getLastScore());
        if (detected) handlers.onDetected(this.engineOptions.keyword);
      },
      stop: () => this.detector.reset(),
    };
  }
}

interface Entry {
  descriptor: WakeWordEngineDescriptor;
  factory: WakeWordEngineFactory;
}

/**
 * Registre des moteurs de détection du mot de réveil. Même principe que les
 * registres STT/TTS : un nouveau moteur s'ajoute avec `register()`. Le
 * repli se fait toujours vers le premier moteur `requiresApiKey = false`
 * (jamais vers un moteur distant : la détection doit rester locale dans
 * tous les cas).
 */
export class WakeWordEngineRegistry {
  private readonly entries = new Map<string, Entry>();

  register(descriptor: WakeWordEngineDescriptor, factory: WakeWordEngineFactory): this {
    this.entries.set(descriptor.id, { descriptor, factory });
    return this;
  }

  list(): WakeWordEngineDescriptor[] {
    return [...this.entries.values()].map((entry) => entry.descriptor);
  }

  describe(id: string): WakeWordEngineDescriptor | undefined {
    return this.entries.get(id)?.descriptor;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  create(config: WakeWordEngineConfig): WakeWordEngine {
    const entry = this.entries.get(config.provider);
    if (!entry) {
      throw new Error(`Moteur de mot de réveil inconnu : ${config.provider}`);
    }
    return entry.factory(config);
  }

  createOrFallback(config: WakeWordEngineConfig): { engine: WakeWordEngine; fellBack: boolean } {
    const entry = this.entries.get(config.provider);
    const needsFallback = !entry || (entry.descriptor.requiresApiKey && !config.apiKey?.trim());
    if (!needsFallback && entry) {
      return { engine: entry.factory(config), fellBack: false };
    }
    const local = [...this.entries.values()].find(
      (candidate) => !candidate.descriptor.requiresApiKey,
    );
    if (!local) {
      throw new Error('Aucun moteur de mot de réveil local disponible en repli.');
    }
    return { engine: local.factory(config), fellBack: true };
  }
}

export type { WakeWordDetectorConfig, WakeWordMatchStrategy };
