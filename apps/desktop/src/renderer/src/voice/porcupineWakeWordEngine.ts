import type {
  WakeWordEngine,
  WakeWordEngineController,
  WakeWordEngineDescriptor,
  WakeWordEngineHandlers,
} from '@jarvis/core';
import type { PorcupineWorker } from '@picovoice/porcupine-web';

export const porcupineWakeWordDescriptor: WakeWordEngineDescriptor = {
  id: 'porcupine',
  label: "Porcupine (Picovoice) — payant pour un usage personnel, clé d'accès requise",
  requiresApiKey: true,
};

/**
 * Chemin, relatif à la racine publique de l'application, où placer le
 * fichier de modèle Porcupine (`porcupine_params.pv`, ~1 Mo, anglais —
 * requis même pour le mot-clé intégré « Jarvis »). Ce fichier n'est ni
 * fourni ni commité : voir le README, section « Porcupine (optionnel) »,
 * pour la marche à suivre et le coût réel de la clé d'accès.
 */
export const PORCUPINE_MODEL_PUBLIC_PATH = 'porcupine/porcupine_params.pv';

/**
 * Intègre Porcupine (Picovoice) derrière `WakeWordEngine` : mot-clé « Jarvis »
 * pré-entraîné, aucune calibration à faire. Reste une **option**, jamais le
 * moteur par défaut — voir le README pour le coût réel de sa formule
 * personnelle (elle n'est plus gratuite depuis le 30 juin 2026).
 *
 * Fonctionne en WebAssembly dans le renderer (a besoin du DOM et
 * d'IndexedDB) : ne peut donc pas vivre dans `packages/core`, au même titre
 * que la reconnaissance et la synthèse locales du navigateur. Alimenté par
 * les mêmes trames PCM que le moteur local — `managesOwnCapture = false` —
 * reformatées en trames Int16 de la taille attendue par Porcupine.
 */
export class PorcupineWakeWordEngine implements WakeWordEngine {
  readonly id = porcupineWakeWordDescriptor.id;
  readonly label = porcupineWakeWordDescriptor.label;
  readonly requiresApiKey = true;
  readonly managesOwnCapture = false;

  constructor(private readonly accessKey: string) {}

  start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
    if (!this.accessKey.trim()) {
      handlers.onError(
        "Clé d'accès Picovoice manquante : configure-la dans les réglages, ou reviens au gabarit local (gratuit).",
      );
      return { stop: () => {} };
    }

    let stopped = false;
    let worker: PorcupineWorker | null = null;
    let ring: Float32Array<ArrayBufferLike> = new Float32Array(0);

    void this.initialize(handlers)
      .then((created) => {
        if (stopped) {
          created?.terminate();
          return;
        }
        worker = created;
      })
      .catch((error: unknown) => handlers.onError(describeError(error)));

    return {
      pushAudio: (frame) => {
        if (stopped || !worker) return;
        ring = concatFloat32(ring, frame);
        const frameLength = worker.frameLength;
        while (ring.length >= frameLength) {
          worker.process(floatToInt16(ring.subarray(0, frameLength)));
          ring = ring.subarray(frameLength);
        }
      },
      stop: () => {
        stopped = true;
        worker?.terminate();
        worker = null;
      },
    };
  }

  private async initialize(handlers: WakeWordEngineHandlers): Promise<PorcupineWorker | null> {
    try {
      const { PorcupineWorker, BuiltInKeyword } = await import('@picovoice/porcupine-web');
      return await PorcupineWorker.create(
        this.accessKey,
        BuiltInKeyword.Jarvis,
        (detection) => handlers.onDetected(detection.label),
        { publicPath: `/${PORCUPINE_MODEL_PUBLIC_PATH}` },
        { processErrorCallback: (error) => handlers.onError(describeError(error)) },
      );
    } catch (error) {
      handlers.onError(describePorcupineError(error));
      return null;
    }
  }
}

function concatFloat32(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function floatToInt16(frame: Float32Array): Int16Array {
  const out = new Int16Array(frame.length);
  for (let index = 0; index < frame.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, frame[index] ?? 0));
    out[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describePorcupineError(error: unknown): string {
  const message = describeError(error);
  if (/fetch|404|network/i.test(message)) {
    return `Modèle Porcupine introuvable (attendu dans apps/desktop/public/${PORCUPINE_MODEL_PUBLIC_PATH}) : ${message}`;
  }
  return `Porcupine indisponible : ${message}`;
}
