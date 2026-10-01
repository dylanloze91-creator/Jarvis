/**
 * Tout le code qui touche le micro vit ici, dans `apps/desktop` : Web Audio
 * API et `getUserMedia` n'existent pas dans `packages/core`, qui reste
 * agnostique du DOM. Ce module fournit le graphe Web Audio (AudioWorklet à
 * 16 kHz) et l'instance unique de `MicrophoneService` (voir `microphone.ts`)
 * que partagent l'écoute, le diagnostic et les tests.
 */
import {
  captureFailureText,
  describeCaptureFailure,
  resampleLinear,
} from '@jarvis/core';
import {
  MicrophoneService,
  type AudioGraph,
  type FrameListener,
  type MicrophoneStatus,
} from './microphone';

export { computeRms } from '@jarvis/core';

const FRAME_SIZE = 1024;
/**
 * 16 kHz : c'est ce qu'attendent Whisper et openWakeWord. Chromium
 * rééchantillonne l'entrée pour ce contexte (meilleure qualité qu'un
 * rééchantillonnage linéaire en JavaScript).
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
let sharedContext: Promise<AudioContext> | null = null;

/**
 * Un seul `AudioContext` (16 kHz) pour toute la session du micro : un
 * changement de périphérique ne recrée que la source et le nœud, pas le
 * contexte ni le module du worklet.
 */
function audioContext(): Promise<AudioContext> {
  sharedContext ??= (async () => {
    let context: AudioContext;
    try {
      context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      context = new AudioContext();
    }
    workletUrl ??= URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(workletUrl);
    } catch (error) {
      void context.close();
      throw error;
    }
    return context;
  })().catch((error: unknown) => {
    sharedContext = null;
    throw error;
  });
  return sharedContext;
}

/** Branche un flux sur le worklet. La capture tourne dans un `AudioWorklet`, jamais sur le fil principal. */
export async function openAudioGraph(stream: MediaStream, onFrame: FrameListener): Promise<AudioGraph> {
  const context = await audioContext();
  if (context.state === 'suspended') await context.resume().catch(() => undefined);
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
    onFrame(frame, TARGET_SAMPLE_RATE);
  };
  source.connect(capture);
  capture.connect(mute);
  mute.connect(context.destination);
  return {
    close: () => {
      capture.port.onmessage = null;
      source.disconnect();
      capture.disconnect();
      mute.disconnect();
    },
    resume: () => context.resume(),
  };
}

function closeAudioGraphs(): void {
  const pending = sharedContext;
  sharedContext = null;
  void pending?.then((context) => context.close()).catch(() => undefined);
}

function sendLog(line: string): void {
  const stamped = `[micro] ${line}`;
  try {
    window.jarvis?.voice?.log?.(stamped);
  } catch {
    // Journal seulement.
  }
  captureLog.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
  if (captureLog.length > 200) captureLog.splice(0, captureLog.length - 200);
}

/** Dernières lignes du journal de capture (copiées par « Tester la voix »). */
export const captureLog: string[] = [];

async function queryMicrophonePermission(): Promise<string> {
  if (!navigator.permissions?.query) return 'inconnu';
  const status = await Promise.race([
    navigator.permissions.query({ name: 'microphone' as PermissionName }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
  ]);
  return status?.state ?? 'inconnu';
}

/** Instance unique : le micro n'est ouvert qu'une fois, quel que soit le nombre d'utilisateurs. */
export const microphone = new MicrophoneService({
  mediaDevices: typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined,
  queryPermission: queryMicrophonePermission,
  openGraph: openAudioGraph,
  closeGraphs: closeAudioGraphs,
  now: () => performance.now(),
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
  log: sendLog,
  getUserMediaTimeoutMs: 10_000,
  enumerateTimeoutMs: 3_000,
  firstFrameTimeoutMs: 4_000,
});

/**
 * Ouvre (ou rejoint) le micro partagé pour un usage ponctuel : test du mot
 * de réveil, échantillon, diagnostic. `deviceId` est le choix enregistré ;
 * il n'y a jamais deux flux ouverts. Rejette avec la cause exacte si le
 * micro ne s'ouvre pas.
 */
export async function startAudioCapture(
  deviceId: string | undefined,
  handlers: AudioCaptureHandlers,
  owner = 'test',
): Promise<AudioCaptureHandle> {
  if (deviceId !== undefined) void microphone.setPreferredDevice(deviceId);
  const release = microphone.acquire(owner);
  const status = await waitForOpen(microphone);
  if (status.phase !== 'open') {
    release();
    throw new Error(status.failure ? captureFailureText(status.failure) : 'Le micro ne s’ouvre pas.');
  }
  const offFrame = microphone.onFrame(handlers.onFrame);
  const offStatus = microphone.subscribe((next) => {
    if (next.phase === 'recovering' && next.failure) handlers.onError(captureFailureText(next.failure));
  });
  return {
    stop: () => {
      offFrame();
      offStatus();
      release();
    },
    deviceId: status.deviceId,
    label: status.label,
  };
}

/** Attend que le micro soit ouvert ou en échec (jamais « en cours »). */
export function waitForOpen(service: MicrophoneService, timeoutMs = 15_000): Promise<MicrophoneStatus> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe = (): void => undefined;
    const finish = (status: MicrophoneStatus): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      queueMicrotask(() => unsubscribe());
      resolve(status);
    };
    const timer = window.setTimeout(() => finish(service.getStatus()), timeoutMs);
    unsubscribe = service.subscribe((status) => {
      if (status.phase === 'open' || status.phase === 'error') finish(status);
    });
    if (done) unsubscribe();
  });
}

/** Erreur `getUserMedia` (ou autre) → une ligne française qui garde le nom exact de l'erreur. */
export function describeMicrophoneError(error: unknown): string {
  return captureFailureText(describeCaptureFailure(error, 'getUserMedia'));
}
