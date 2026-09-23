import { buildWakeWordProfile, type WakeWordProfile } from '@jarvis/core';
import { computeRms, startAudioCapture } from './audioCapture';

const SAMPLE_DURATION_MS = 1200;

/**
 * Enregistre un court échantillon local du mot de réveil et construit son
 * gabarit d'énergie. L'audio brut n'est jamais conservé ni envoyé nulle
 * part : seule l'enveloppe (quelques dizaines de nombres) est gardée, dans
 * les réglages.
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
