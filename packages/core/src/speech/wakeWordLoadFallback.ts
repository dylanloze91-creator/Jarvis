import type {
  WakeWordEngine,
  WakeWordEngineController,
  WakeWordEngineHandlers,
} from './wakewordEngine.js';

const PARALLEL_DETECTION_COOLDOWN_MS = 1600;

export interface WakeWordLoadFallbackOptions {
  /**
   * Si vrai, le repli tourne en parallèle dès le départ : il peut détecter
   * « Jarvis » même si le primaire (`hey_jarvis`) charge mais ne score
   * jamais assez. Sinon, le repli ne démarre qu'après une erreur de
   * chargement — et reste muet tant que le modèle ONNX « réussit » à
   * charger.
   */
  alwaysOn?: boolean;
}

/**
 * Repli du mot de réveil. Par défaut : seulement si le primaire échoue au
 * chargement. Avec `alwaysOn` : le gabarit / confirmation Whisper écoute
 * en même temps, pour un « Jarvis » nu que `hey_jarvis_v0.1` ignore.
 */
export function wrapWakeWordEngineWithLoadFallback(
  primary: WakeWordEngine,
  createFallback: () => WakeWordEngine,
  options: WakeWordLoadFallbackOptions = {},
): WakeWordEngine {
  const alwaysOn = options.alwaysOn === true;
  return {
    get id() {
      return primary.id;
    },
    get label() {
      return primary.label;
    },
    get managesOwnCapture() {
      return primary.managesOwnCapture;
    },
    start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
      let stopped = false;
      let primaryFailed = false;
      let lastDetectionAt = -Infinity;
      let lastSource: 'primary' | 'fallback' = 'primary';
      let fallbackController: WakeWordEngineController | null = null;

      const emitDetected = (keyword: string, source: 'primary' | 'fallback'): void => {
        if (stopped) return;
        const now = Date.now();
        if (now - lastDetectionAt < PARALLEL_DETECTION_COOLDOWN_MS) return;
        lastDetectionAt = now;
        lastSource = source;
        handlers.onDetected(keyword);
      };

      const startFallback = (forwardErrors: boolean): boolean => {
        if (fallbackController) return true;
        try {
          fallbackController = createFallback().start({
            onScore: (score) => {
              if (primaryFailed) handlers.onScore?.(score);
            },
            onDetected: (keyword) => emitDetected(keyword, 'fallback'),
            onError: (message) => {
              if (stopped) return;
              if (forwardErrors || primaryFailed) handlers.onError(message);
            },
          });
          return true;
        } catch (error) {
          handlers.onError(
            error instanceof Error ? error.message : `Repli du mot de réveil impossible : ${String(error)}`,
          );
          return false;
        }
      };

      if (alwaysOn) startFallback(false);

      const primaryController = primary.start({
        onScore: (score) => {
          if (!primaryFailed) handlers.onScore?.(score);
        },
        onDetected: (keyword) => emitDetected(keyword, 'primary'),
        onError: (message) => {
          if (stopped || primaryFailed) return;
          primaryFailed = true;
          primaryController.stop();
          if (!startFallback(true)) {
            handlers.onError(message);
          }
        },
      });

      return {
        getLastAnalyzedWindow: () =>
          lastSource === 'fallback'
            ? (fallbackController?.getLastAnalyzedWindow?.() ?? null)
            : (primaryController.getLastAnalyzedWindow?.() ?? null),
        pushAudio: (frame, sampleRate) => {
          if (stopped) return;
          if (!primaryFailed) primaryController.pushAudio?.(frame, sampleRate);
          fallbackController?.pushAudio?.(frame, sampleRate);
        },
        stop: () => {
          stopped = true;
          primaryController.stop();
          fallbackController?.stop();
        },
      };
    },
  };
}
