/**
 * Tout le code qui touche le micro vit ici, dans `apps/desktop` : Web Audio
 * API et `getUserMedia` n'existent pas dans `packages/core`, qui reste
 * agnostique du DOM. Ce module se limite à la capture brute (trames PCM +
 * niveau sonore) ; la détection du mot de réveil et la transcription sont
 * des couches séparées qui consomment ces trames.
 */
import { chooseMicrophone, resampleLinear, type AudioInputOption } from '@jarvis/core';

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
  /** Périphérique réellement ouvert. */
  deviceId: string;
  label: string;
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
    const channels = (inputs[0] || []).filter(Boolean);
    const first = channels[0];
    if (!first || !first.length) return true;
    const count = channels.length;
    let index = 0;
    while (index < first.length) {
      const n = Math.min(first.length - index, this.size - this.offset);
      for (let i = 0; i < n; i += 1) {
        let sum = 0;
        for (let c = 0; c < count; c += 1) sum += channels[c][index + i] || 0;
        this.buffer[this.offset + i] = sum / count;
      }
      this.offset += n;
      index += n;
      if (this.offset === this.size) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.size);
        this.offset = 0;
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
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    processorOptions: { frameSize: FRAME_SIZE },
  });
  // Relié à la destination par un gain nul : le nœud est bien traité, et
  // rien ne part vers les haut-parleurs (pas d'écho).
  const mute = context.createGain();
  mute.gain.value = 0;

  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const rate = context.sampleRate;
    const frame = rate === TARGET_SAMPLE_RATE ? event.data : resampleLinear(event.data, rate, TARGET_SAMPLE_RATE);
    handlers.onFrame(frame, TARGET_SAMPLE_RATE);
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

  const actualId = stream.getAudioTracks()[0]?.getSettings?.().deviceId ?? deviceId ?? '';
  let label = '';
  try {
    const devices = await listMicrophones();
    label = devices.find((device) => device.deviceId === actualId)?.label ?? '';
  } catch {
    label = '';
  }

  return { stop, deviceId: actualId, label };
}

function requestInput(deviceId: string | undefined): Promise<MediaStream> {
  if (!deviceId) return navigator.mediaDevices.getUserMedia({ audio: true });
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: deviceId }, channelCount: { ideal: 1 } },
  });
}

async function listedInputs(): Promise<AudioInputOption[]> {
  const devices = await prepareMicrophoneList();
  return devices.map((device) => ({ deviceId: device.deviceId, label: device.label }));
}

/**
 * Liste les entrées. Sans autorisation les libellés sont vides et un mixage
 * est indiscernable d'un micro : on ouvre brièvement le défaut pour les lire,
 * puis on le referme.
 */
export async function prepareMicrophoneList(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  let devices = await listMicrophones();
  if (devices.length > 0 && devices.every((device) => !device.label) && navigator.mediaDevices.getUserMedia) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of probe.getTracks()) track.stop();
      devices = await listMicrophones();
    } catch {
      // Pas d'autorisation : la liste reste sans nom.
    }
  }
  return devices;
}

/**
 * Ouvre l'entrée demandée, mixage compris. Sans identifiant, c'est le défaut
 * Windows (même périphérique que les autres applications). Sans liste
 * (tests, permission pas encore lisible) : l'identifiant demandé, puis le
 * défaut du système. Un périphérique disparu ne bascule pas vers un autre
 * micro de la liste.
 */
export async function openMicrophone(deviceId: string | undefined): Promise<MediaStream> {
  const inputs = await listedInputs();
  if (inputs.length === 0) return openExactOrDefault(deviceId);
  const choice = chooseMicrophone(inputs, deviceId ?? '');
  if (!choice) return openExactOrDefault(deviceId);
  try {
    return await requestInput(choice.deviceId);
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw error;
    if (!deviceId || choice.deviceId === 'default') throw error;
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

async function openExactOrDefault(deviceId: string | undefined): Promise<MediaStream> {
  if (!deviceId) return navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    return await requestInput(deviceId);
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
