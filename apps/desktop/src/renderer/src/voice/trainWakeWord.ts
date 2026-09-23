import {
  WakeWordDetector,
  buildWakeWordProfile,
  computeRms,
  type WakeWordDetectorConfig,
  type WakeWordProfile,
} from '@jarvis/core';
import { startAudioCapture, type AudioCaptureHandle } from './audioCapture';

const SAMPLE_DURATION_MS = 1200;

/**
 * Enregistre un court échantillon local du mot de réveil et construit son
 * gabarit d'énergie. L'audio brut n'est jamais conservé ni envoyé nulle
 * part : seule l'enveloppe (quelques dizaines de nombres) est gardée, dans
 * les réglages. Le composant appelant est responsable d'accumuler plusieurs
 * échantillons (`voice.wakeWordProfiles`) : cette fonction n'en produit
 * qu'un à la fois.
 */
export async function recordWakeWordProfile(
  deviceId: string | undefined,
): Promise<WakeWordProfile> {
  const energies: number[] = [];

  const handle = await startAudioCapture(deviceId, {
    onFrame: (frame) => energies.push(computeRms(frame)),
    onError: () => {},
  });

  await new Promise((resolve) => setTimeout(resolve, SAMPLE_DURATION_MS));
  handle.stop();

  if (energies.length === 0) {
    throw new Error("Aucun son capturé pendant l'enregistrement.");
  }
  return buildWakeWordProfile(energies);
}

export interface WakeWordTestHandle {
  stop: () => void;
}

/**
 * Boucle de test en direct pour la calibration : réutilise le même
 * détecteur que la production (`WakeWordDetector`) sur le micro choisi, et
 * remonte le score de similarité en continu — l'utilisateur voit tout de
 * suite si la sensibilité choisie est trop stricte ou trop permissive,
 * avant même d'activer l'écoute permanente.
 */
export async function startWakeWordTest(
  deviceId: string | undefined,
  detectorConfig: WakeWordDetectorConfig | null,
  sensitivity: number,
  onUpdate: (score: number, detected: boolean) => void,
  onError: (message: string) => void,
): Promise<WakeWordTestHandle> {
  const detector = new WakeWordDetector(detectorConfig);
  detector.setSensitivity(sensitivity);

  let handle: AudioCaptureHandle | null = null;
  handle = await startAudioCapture(deviceId, {
    onFrame: (frame) => {
      const rms = computeRms(frame);
      const detected = detector.pushEnergy(rms);
      onUpdate(detector.getLastScore(), detected);
    },
    onError,
  });

  return {
    stop: () => handle?.stop(),
  };
}
