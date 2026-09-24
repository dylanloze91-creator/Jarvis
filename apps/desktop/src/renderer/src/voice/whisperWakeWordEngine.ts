import {
  WHISPER_WAKE_WORD_LANGUAGE,
  WHISPER_WAKE_WORD_MODEL,
  concatFloat32,
  evaluateWakeWordWindow,
  type TranscribeWindow,
  type WakeWordEngine,
  type WakeWordEngineConfig,
  type WakeWordEngineController,
  type WakeWordEngineDescriptor,
  type WakeWordEngineHandlers,
} from '@jarvis/core';
import { transcribeWithWhisper } from './whisper/pipelineLoader';

export const whisperWakeWordDescriptor: WakeWordEngineDescriptor = {
  id: 'whisper-transcript',
  label: 'Whisper local (transcription en continu, gratuit) — recommandé',
  requiresApiKey: false,
};

/** Fenêtre glissante analysée : assez longue pour contenir « Jarvis » prononcé normalement, pas plus. */
const WINDOW_MS = 1600;
/** Fraction minimale de la fenêtre déjà accumulée avant la première analyse possible. */
const MIN_WINDOW_FILL_RATIO = 0.6;
/** Intervalle minimal entre deux analyses, même si la parole continue : borne le coût CPU. */
const MIN_ANALYSIS_INTERVAL_MS = 700;
/** Délai minimal entre deux détections successives, comme pour le détecteur par gabarit. */
const COOLDOWN_MS = 1500;

export interface WhisperWakeWordEngineOptions {
  keyword: string;
  variants: string[];
  /** 0 (strict, économe en CPU) à 1 (très sensible, plus de fenêtres analysées). */
  sensitivity: number;
}

export function createWhisperWakeWordEngine(config: WakeWordEngineConfig): WhisperWakeWordEngine {
  return new WhisperWakeWordEngine({
    keyword: config.keyword ?? 'jarvis',
    variants: config.variants ?? [],
    sensitivity: config.sensitivity ?? 0.5,
  });
}

/**
 * 0 (strict) mappe sur une énergie de garde plus haute — moins de fenêtres
 * jugées candidates, donc moins de transcriptions, donc moins de CPU ; 1
 * (sensible) mappe sur une énergie plus basse, au prix d'analyser plus
 * souvent (voix faible détectée, mais ventilateur qui tourne davantage).
 */
function sensitivityToPeakEnergy(sensitivity: number): number {
  const clamped = Math.min(1, Math.max(0, sensitivity));
  const max = 0.035;
  const min = 0.008;
  return max - clamped * (max - min);
}

/**
 * Moteur de mot de réveil « par transcription » : Whisper
 * (`WHISPER_WAKE_WORD_MODEL` — voir ce module pour pourquoi c'est `base` et
 * non `tiny`, insuffisant en pratique — quel que soit le modèle choisi pour
 * la dictée) tourne sur de courtes fenêtres glissantes, décodées en anglais
 * (`WHISPER_WAKE_WORD_LANGUAGE`, voir aussi ce module), et le texte produit
 * est comparé au mot de réveil (`evaluateWakeWordWindow`, cœur pur dans
 * `packages/core`). Remplace le gabarit d'énergie
 * (`local-template`) comme moteur par défaut : celui-ci ne compare que des
 * volumes dans le temps, sans aucune information spectrale — trop faible
 * pour reconnaître un mot en conditions réelles.
 *
 * Trois précautions contre un usage CPU excessif en écoute permanente :
 * garde d'énergie (rien n'est transcrit en silence), intervalle minimal
 * entre deux analyses, et un seul appel Whisper en vol à la fois (une
 * analyse en cours empêche d'en lancer une seconde tant qu'elle n'est pas
 * terminée). Aucun audio ne quitte jamais la machine : Whisper tourne dans
 * ce processus, sans requête réseau une fois le modèle en cache.
 *
 * Conserve la fenêtre PCM qui a déclenché la détection
 * (`getLastAnalyzedWindow`) : `useVoice.ts` la transmet en préfixe au
 * moteur de dictée, qui transcrit ainsi l'énoncé complet (mot de réveil
 * compris) plutôt que l'audio coupé pile à l'instant de la détection —
 * vérifié en pratique : couper au mauvais endroit pouvait amputer l'attaque
 * du mot suivant, alors que la phrase entière donne aussi plus de contexte
 * à Whisper pour bien reconnaître le mot de réveil lui-même.
 */
export class WhisperWakeWordEngine implements WakeWordEngine {
  readonly id = whisperWakeWordDescriptor.id;
  readonly label = whisperWakeWordDescriptor.label;
  readonly requiresApiKey = false;
  readonly managesOwnCapture = false;

  private readonly minPeakEnergy: number;

  constructor(private readonly engineOptions: WhisperWakeWordEngineOptions) {
    this.minPeakEnergy = sensitivityToPeakEnergy(engineOptions.sensitivity);
  }

  start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
    let buffer: Float32Array[] = [];
    let bufferedMs = 0;
    let sampleRate = 16000;
    let analyzing = false;
    let lastAnalysisAt = 0;
    let cooldownUntil = 0;
    let stopped = false;
    let lastAnalyzedWindow: { pcm: Float32Array; sampleRate: number } | null = null;

    const transcribeWindow: TranscribeWindow = async (frame) =>
      transcribeWithWhisper(WHISPER_WAKE_WORD_MODEL.repo, frame, {
        language: WHISPER_WAKE_WORD_LANGUAGE,
      });

    return {
      getLastAnalyzedWindow: () => lastAnalyzedWindow,
      pushAudio: (frame, rate) => {
        if (stopped) return;
        sampleRate = rate;
        buffer.push(frame);
        bufferedMs += (frame.length / rate) * 1000;
        while (bufferedMs > WINDOW_MS && buffer.length > 1) {
          const removed = buffer.shift()!;
          bufferedMs -= (removed.length / sampleRate) * 1000;
        }

        const now = performance.now();
        if (analyzing) return;
        if (now < cooldownUntil) return;
        if (now - lastAnalysisAt < MIN_ANALYSIS_INTERVAL_MS) return;
        if (bufferedMs < WINDOW_MS * MIN_WINDOW_FILL_RATIO) return;

        lastAnalysisAt = now;
        analyzing = true;
        const snapshot = concatFloat32(buffer);
        const analysisSampleRate = sampleRate;

        void evaluateWakeWordWindow(
          snapshot,
          analysisSampleRate,
          transcribeWindow,
          { word: this.engineOptions.keyword, variants: this.engineOptions.variants },
          { minPeakEnergy: this.minPeakEnergy },
        )
          .then((result) => {
            if (stopped) return;
            handlers.onScore?.(result.matched ? 1 : 0);
            if (result.matched) {
              cooldownUntil = performance.now() + COOLDOWN_MS;
              lastAnalyzedWindow = { pcm: snapshot, sampleRate: analysisSampleRate };
              buffer = [];
              bufferedMs = 0;
              handlers.onDetected(this.engineOptions.keyword);
            }
          })
          .catch((error: unknown) => {
            if (!stopped) handlers.onError(describeError(error));
          })
          .finally(() => {
            analyzing = false;
          });
      },
      stop: () => {
        stopped = true;
        buffer = [];
        bufferedMs = 0;
      },
    };
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Détection du mot de réveil indisponible : ${message}`;
}
