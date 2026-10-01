/**
 * Couche personnelle par-dessus les détecteurs (Vosk, openWakeWord) : un
 * réveil passe par le vérificateur quand un modèle est actif ; sinon il est
 * transmis tel quel, sans attente (comportement 0.4.16). Les modèles des
 * détecteurs ne changent pas.
 */
import type {
  WakeWordEngine,
  WakeWordEngineController,
  WakeWordEngineHandlers,
  WakeWordWindow,
} from '../wakewordEngine.js';
import { resampleLinear } from '../openWakeWord.js';
import { concatFloat32 } from '../wav.js';
import { wakeClipFromWindow } from './features.js';
import {
  decideWakeCandidate,
  scoreWakeFeatures,
  type WakeCandidateKind,
  type WakeDecision,
  type WakeVerifierModel,
} from './verifier.js';

export interface WakeCandidateReport {
  kind: WakeCandidateKind;
  decision: WakeDecision;
  /** Extrait fixe de 2 s à 16 kHz (gardé seulement si l'apprentissage l'étiquette). */
  clip: Float32Array;
  features: number[] | null;
}

export interface WakeVerifierLayer {
  /** Modèle courant, relu à chaque candidat (réentraînement sans redémarrer le moteur). */
  getModel: () => WakeVerifierModel | null;
  /** Caractéristiques openWakeWord de l'extrait, ou `null` si les modèles ne sont pas disponibles. */
  features: (clip: Float32Array) => Promise<number[] | null>;
  /** Chaque candidat décidé, pour l'étiquetage. */
  onCandidate?: (report: WakeCandidateReport) => void;
  /** Journal sans audio ni texte. */
  log?: (line: string) => void;
}

/** Audio gardé pendant une vérification, pour ne pas perdre le début de la commande. */
const MAX_PENDING_SECONDS = 3;

export function wrapWakeWordEngineWithVerifier(engine: WakeWordEngine, layer: WakeVerifierLayer): WakeWordEngine {
  return {
    get id() {
      return engine.id;
    },
    get label() {
      return engine.label;
    },
    get managesOwnCapture() {
      return engine.managesOwnCapture;
    },
    start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
      let stopped = false;
      let acceptedWindow: WakeWordWindow | null = null;
      let pending = 0;
      let heldFrames: Float32Array[] = [];
      let heldSamples = 0;

      const withHeldAudio = (window: WakeWordWindow): WakeWordWindow => {
        if (heldFrames.length === 0) return window;
        return { ...window, pcm: concatFloat32([window.pcm, ...heldFrames]) };
      };

      const verify = (kind: WakeCandidateKind, keyword: string, window: WakeWordWindow): void => {
        const model = layer.getModel();
        const clip = wakeClipFromWindow(window);
        const gated = model !== null && (kind === 'near-miss' ? model.rescueThreshold !== null : model.vetoEnabled);
        if (kind === 'detected' && !gated) {
          acceptedWindow = null;
          handlers.onDetected(keyword);
          if (layer.onCandidate) {
            void layer.features(clip).then((features) => {
              const probability = model && features ? scoreWakeFeatures(model, features) : null;
              layer.onCandidate?.({ kind, decision: decideWakeCandidate(null, kind, probability), clip, features });
            });
          }
          return;
        }
        pending += 1;
        if (pending === 1) {
          heldFrames = [];
          heldSamples = 0;
        }
        void layer
          .features(clip)
          .catch(() => null)
          .then((features) => {
            pending -= 1;
            if (stopped) return;
            const probability = model && features ? scoreWakeFeatures(model, features) : null;
            const decision = decideWakeCandidate(gated ? model : null, kind, probability);
            layer.log?.(
              `${kind === 'detected' ? 'réveil' : 'quasi-réveil'} : ${decision.reason}${probability === null ? '' : ` (p = ${probability.toFixed(2)})`}`,
            );
            layer.onCandidate?.({ kind, decision, clip, features });
            if (decision.accept) {
              acceptedWindow = withHeldAudio(window);
              handlers.onDetected(keyword);
            }
            if (pending === 0) {
              heldFrames = [];
              heldSamples = 0;
            }
          });
      };

      const inner = engine.start({
        onScore: handlers.onScore,
        onError: handlers.onError,
        onDetected: (keyword) => {
          const window = inner.getLastAnalyzedWindow?.() ?? null;
          if (!window) {
            acceptedWindow = null;
            handlers.onDetected(keyword);
            return;
          }
          verify('detected', keyword, window);
        },
        onNearMiss: (keyword, window) => verify('near-miss', keyword, window),
      });

      return {
        getLastAnalyzedWindow: () => acceptedWindow ?? inner.getLastAnalyzedWindow?.() ?? null,
        pushAudio: (frame, sampleRate) => {
          if (stopped) return;
          if (pending > 0 && heldSamples < MAX_PENDING_SECONDS * 16000) {
            const at16k = sampleRate === 16000 ? frame : resampleLinear(frame, sampleRate, 16000);
            heldFrames.push(at16k.slice());
            heldSamples += at16k.length;
          }
          inner.pushAudio?.(frame, sampleRate);
        },
        stop: () => {
          stopped = true;
          inner.stop();
        },
      };
    },
  };
}
