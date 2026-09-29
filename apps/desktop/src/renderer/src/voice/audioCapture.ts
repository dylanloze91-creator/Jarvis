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
 * 16 kHz : c'est ce qu'attendent Whisper et openWakeWord. Demander
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
 * Découpe l'entrée en trames de `frameSize` échantillons sur le thread audio.
 * Les messages s'accumulent si le thread principal est occupé (inférence
 * Whisper) et arrivent ensuite, dans l'ordre : aucune trame perdue.
 */
export const CAPTURE_WORKLET_SOURCE = `
class JarvisCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.frameSize;
    this.buffer = new Float32Array(this.size);
    this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let index = 0;
      while (index < channel.length) {
        const count = Math.min(channel.length - index, this.size - this.offset);
        this.buffer.set(channel.subarray(index, index + count), this.offset);
        this.offset += count;
        index += count;
        if (this.offset === this.size) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.size);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('jarvis-capture', JarvisCapture);
`;

let workletUrl: string | null = null;

/**
 * Ouvre le micro et pousse des trames PCM de 4096 échantillons à 16 kHz.
 * La capture tourne dans un `AudioWorklet` : l'ancien `ScriptProcessorNode`
 * vivait sur le thread principal, et pendant chaque inférence Whisper
 * (~1 s) Chromium jetait l'audio — la commande dite juste après « Jarvis »
 * était perdue.
 */
export async function startAudioCapture(
  deviceId: string | undefined,
  handlers: AudioCaptureHandlers,
): Promise<AudioCaptureHandle> {
  let stream: MediaStream;
  try {
    stream = await openMicrophone(deviceId);
  } catch (error) {
    throw new Error(describeMicrophoneError(error));
  }

  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  workletUrl ??= URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: 'text/javascript' }));
  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
    throw new Error(`Capture audio impossible : ${error instanceof Error ? error.message : String(error)}`);
  }
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, 'jarvis-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    processorOptions: { frameSize: FRAME_SIZE },
  });
  // Relié à la destination par un gain nul : le nœud est bien traité, et
  // rien ne part vers les haut-parleurs (pas d'écho).
  const mute = context.createGain();
  mute.gain.value = 0;

  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    handlers.onFrame(event.data, context.sampleRate);
  };

  source.connect(capture);
  capture.connect(mute);
  mute.connect(context.destination);

  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => handlers.onError('Le microphone a été déconnecté.'));
  }

  const stop = (): void => {
    capture.port.onmessage = null;
    capture.disconnect();
    source.disconnect();
    mute.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  return { stop };
}

/** Micro choisi dans les réglages puis débranché : on reprend le micro par défaut. */
export async function openMicrophone(deviceId: string | undefined): Promise<MediaStream> {
  if (!deviceId) return navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw error;
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

/** Messages de `getUserMedia` en français (Chromium les donne en anglais, parfois vides). */
export function describeMicrophoneError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Aucun micro détecté. Branche un micro, ou choisis-en un autre dans les réglages.';
    case 'NotAllowedError':
    case 'SecurityError':
      return "L'accès au micro est refusé. Autorise-le dans Paramètres Windows > Confidentialité > Microphone.";
    case 'NotReadableError':
    case 'AbortError':
      return 'Le micro est occupé par une autre application ou ne répond pas.';
    default: {
      const message = error instanceof Error ? error.message.trim() : String(error ?? '').trim();
      return message ? `Micro indisponible : ${message}` : 'Micro indisponible.';
    }
  }
}
