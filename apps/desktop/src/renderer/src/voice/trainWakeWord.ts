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

  let handle: AudioCaptureHandle;
  try {
    handle = await startAudioCapture(deviceId, {
      onFrame: (frame) => energies.push(computeRms(frame)),
      onError: () => {},
    });
  } catch (error) {
    throw new Error(describeMicrophoneError(error));
  }

  await new Promise((resolve) => setTimeout(resolve, SAMPLE_DURATION_MS));
  handle.stop();

  if (energies.length === 0) {
    throw new Error("Aucun son capturé pendant l'enregistrement.");
  }
  if (Math.max(...energies) < 0.02) {
    throw new Error('Rien n’a été entendu : parle plus fort ou vérifie le microphone.');
  }
  return buildWakeWordProfile(energies);
}

/** Les erreurs de `getUserMedia` arrivent en anglais et sans contexte utile. */
export function describeMicrophoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'NotAllowedError' || /permission/i.test(message)) {
    return 'Accès au microphone refusé. Autorise-le dans les réglages de Windows, puis réessaie.';
  }
  if (name === 'NotFoundError' || /device not found/i.test(message)) {
    return 'Aucun microphone détecté. Branche-en un, ou choisis-en un autre ci-dessus.';
  }
  if (name === 'NotReadableError') {
    return 'Le microphone est déjà utilisé par une autre application.';
  }
  return `Microphone indisponible : ${message}`;
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
  try {
    handle = await startAudioCapture(deviceId, {
      onFrame: (frame) => {
        const rms = computeRms(frame);
        const detected = detector.pushEnergy(rms);
        onUpdate(detector.getLastScore(), detected);
      },
      onError,
    });
  } catch (error) {
    throw new Error(describeMicrophoneError(error));
  }

  return {
    stop: () => handle?.stop(),
  };
}
