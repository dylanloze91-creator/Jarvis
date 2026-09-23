/**
 * Tout le code qui touche le micro vit ici, dans `apps/desktop` : Web Audio
 * API et `getUserMedia` n'existent pas dans `packages/core`, qui reste
 * agnostique du DOM. Ce module se limite à la capture brute (trames PCM +
 * niveau sonore) ; la détection du mot de réveil et la transcription sont
 * des couches séparées qui consomment ces trames.
 */
export { computeRms } from '@jarvis/core';

const FRAME_SIZE = 4096;
/**
 * 16 kHz : c'est ce qu'attendent aussi bien Whisper que Porcupine. Demander
 * ce taux dès la capture évite un ré-échantillonnage manuel dans chaque
 * consommateur (le détecteur local, lui, n'y est pas sensible).
 */
const TARGET_SAMPLE_RATE = 16000;

export interface AudioCaptureHandlers {
  /** Trame PCM mono brute, amplitude normalisée [-1, 1]. */
  onFrame: (frame: Float32Array, sampleRate: number) => void;
  onError: (message: string) => void;
}

export interface AudioCaptureHandle {
  stop: () => void;
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput');
}

/**
 * Ouvre le micro et pousse des trames PCM régulières. Utilise
 * `ScriptProcessorNode`, obsolète mais toujours pris en charge et
 * nettement plus simple qu'un `AudioWorklet` séparé pour un MVP ; migrer
 * vers `AudioWorkletNode` est l'étape suivante si la dépréciation devient
 * bloquante.
 */
export async function startAudioCapture(
  deviceId: string | undefined,
  handlers: AudioCaptureHandlers,
): Promise<AudioCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });

  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(FRAME_SIZE, 1, 1);
  // Un ScriptProcessorNode ne s'exécute que s'il est relié à une
  // destination ; on le coupe avec un gain nul pour ne rien renvoyer aux
  // haut-parleurs (éviter tout écho).
  const mute = context.createGain();
  mute.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const channel = event.inputBuffer.getChannelData(0);
    handlers.onFrame(new Float32Array(channel), context.sampleRate);
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => handlers.onError('Le microphone a été déconnecté.'));
  }

  const stop = (): void => {
    processor.onaudioprocess = null;
    processor.disconnect();
    source.disconnect();
    mute.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  return { stop };
}
