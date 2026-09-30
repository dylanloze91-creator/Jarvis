import {
  buildWakeWordProfileFromEnergyFrames,
  buildWakeWordProfilesFromPcm,
  computeRms,
  type WakeWordEngineConfig,
  type WakeWordProfile,
} from '@jarvis/core';
import { startAudioCapture, type AudioCaptureHandle } from './audioCapture';
import { VOICE_SAMPLE_RATE, decodeAudioToMono16k } from './audioDecode';
import { createWakeWordEngine } from './registries';

const SAMPLE_DURATION_MS = 1200;

/**
 * Enregistre un court échantillon local du mot de réveil et construit son
 * gabarit d'énergie. L'audio brut n'est jamais conservé ni envoyé à Whisper :
 * seule l'enveloppe (quelques dizaines de nombres) est gardée, dans les
 * réglages. Whisper ne s'en sert pas pour s'entraîner — il confirme ensuite
 * que le candidat est bien « Jarvis ».
 */
export async function recordWakeWordProfile(
  deviceId: string | undefined,
): Promise<WakeWordProfile> {
  const energies: number[] = [];

  // `startAudioCapture` rejette déjà avec la cause exacte (nom de l'erreur compris).
  const handle: AudioCaptureHandle = await startAudioCapture(
    deviceId,
    {
      onFrame: (frame) => energies.push(computeRms(frame)),
      onError: () => {},
    },
    'échantillon',
  );

  await new Promise((resolve) => setTimeout(resolve, SAMPLE_DURATION_MS));
  handle.stop();

  const result = buildWakeWordProfileFromEnergyFrames(energies);
  if (!result.ok && result.reason === 'empty') {
    throw new Error("Aucun son capturé pendant l'enregistrement.");
  }
  if (!result.ok && result.reason === 'silent') {
    throw new Error('Rien n’a été entendu : parle plus fort ou vérifie le microphone.');
  }
  if (!result.ok) {
    throw new Error(
      'Ça ne ressemble pas à une prise vocale. Dis « Jarvis » clairement, sans trop de silence autour.',
    );
  }
  return result.profile;
}

/**
 * Importe un WAV ou un MP3 comme gabarit de déclenchement — pas comme
 * données d'entraînement Whisper. Chromium décode les deux formats via
 * `decodeAudioData` ; l'audio brut est jeté dès que l'enveloppe est extraite.
 */
export async function importWakeWordProfilesFromAudioFile(file: File): Promise<WakeWordProfile[]> {
  let pcm: Float32Array;
  try {
    pcm = await decodeAudioToMono16k(await file.arrayBuffer());
  } catch {
    throw new Error(`Impossible de lire « ${file.name} ». Utilise un WAV ou un MP3.`);
  }

  const result = buildWakeWordProfilesFromPcm(pcm, VOICE_SAMPLE_RATE);
  if (!result.ok && result.reason === 'empty') {
    throw new Error(`« ${file.name} » est trop court pour servir de gabarit.`);
  }
  if (!result.ok && result.reason === 'silent') {
    throw new Error(
      `Rien n’a été entendu dans « ${file.name} » : enregistre « Jarvis » plus fort, ou choisis un autre fichier.`,
    );
  }
  if (!result.ok) {
    throw new Error(
      `« ${file.name} » ne contient pas de prise vocale utilisable (silence, clic ou bruit).`,
    );
  }
  return result.profiles;
}

/** @deprecated préfère `importWakeWordProfilesFromAudioFile` (plusieurs rafales). */
export async function importWakeWordProfileFromAudioFile(file: File): Promise<WakeWordProfile> {
  const profiles = await importWakeWordProfilesFromAudioFile(file);
  return profiles[0]!;
}

export interface WakeWordTestHandle {
  stop: () => void;
}

/**
 * Test en direct : le même moteur que l'écoute permanente
 * (`createWakeWordEngine` : openWakeWord + « Jarvis » nu confirmé par
 * Whisper), sur le micro choisi. Le score affiché est celui d'openWakeWord.
 */
export async function startWakeWordTest(
  deviceId: string | undefined,
  config: WakeWordEngineConfig,
  onUpdate: (score: number, detected: boolean) => void,
  onError: (message: string) => void,
): Promise<WakeWordTestHandle> {
  const controller = createWakeWordEngine(config).start({
    onScore: (score) => onUpdate(score, false),
    onDetected: () => onUpdate(1, true),
    onError,
  });

  let handle: AudioCaptureHandle | null = null;
  try {
    handle = await startAudioCapture(
      deviceId,
      {
        onFrame: (frame, sampleRate) => controller.pushAudio?.(frame, sampleRate),
        onError,
      },
      'test du mot de réveil',
    );
  } catch (error) {
    controller.stop();
    throw error;
  }

  return {
    stop: () => {
      handle?.stop();
      controller.stop();
    },
  };
}
