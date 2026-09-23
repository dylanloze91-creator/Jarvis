import { buildWakeWordEnvelope } from '@jarvis/core';
import { computeRms, startAudioCapture } from './audioCapture';

const SAMPLE_DURATION_MS = 1400;

export interface RecordingProgress {
  /** Niveau sonore instantané (0 à ~1), pour l'indicateur visuel. */
  level: number;
  /** Fraction écoulée de l'enregistrement, de 0 à 1. */
  elapsed: number;
}

/**
 * Enregistre un échantillon local du mot de réveil et construit son gabarit
 * d'énergie. L'audio brut n'est jamais conservé ni envoyé nulle part : seule
 * l'enveloppe (quelques dizaines de nombres) est gardée, dans les réglages.
 */
export async function recordWakeWordSample(
  deviceId: string | undefined,
  onProgress?: (progress: RecordingProgress) => void,
): Promise<number[]> {
  const energies: number[] = [];
  const startedAt = performance.now();

  let handle;
  try {
    handle = await startAudioCapture(deviceId, {
      onFrame: (frame) => {
        const rms = computeRms(frame);
        energies.push(rms);
        onProgress?.({
          level: rms,
          elapsed: Math.min(1, (performance.now() - startedAt) / SAMPLE_DURATION_MS),
        });
      },
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
  return buildWakeWordEnvelope(energies);
}

/** Les erreurs de `getUserMedia` arrivent en anglais et sans contexte utile. */
function describeMicrophoneError(error: unknown): string {
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
