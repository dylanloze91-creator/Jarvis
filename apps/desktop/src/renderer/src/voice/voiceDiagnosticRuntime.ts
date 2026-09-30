import { computeRms, concatFloat32, voiceAssetUrl, type VoiceSettings } from '@jarvis/core';
import { startAudioCapture } from './audioCapture';
import { configureOnnxRuntime, onnxRuntimeVersion, withOrtLock } from './onnxRuntime';
import {
  OpenWakeWordEngine,
  loadOpenWakeWordModels,
  type OpenWakeWordOnnxModels,
} from './openWakeWordEngine';
import {
  WHISPER_LOAD_TIMEOUT_MS,
  describeWhisperLoadError,
  getWhisperPipeline,
  transcribeWithWhisper,
} from './whisper/pipelineLoader';
import { VOICE_SAMPLE_RATE, decodeAudioToMono16k } from './audioDecode';
import {
  analyzeRecording,
  type MicrophoneProbe,
  type RecordingAnalysis,
  type VoiceDiagnosticDeps,
} from './voiceDiagnostic';

let wakeWordModels: Promise<OpenWakeWordOnnxModels> | null = null;

function openWakeWordModels(): Promise<OpenWakeWordOnnxModels> {
  wakeWordModels ??= loadOpenWakeWordModels().catch((error: unknown) => {
    wakeWordModels = null;
    throw error;
  });
  return wakeWordModels;
}

/** Même moteur que l'écoute permanente, sur un extrait déjà enregistré. */
export async function scoreWakeWordClip(pcm: Float32Array, sampleRate = 16000): Promise<number> {
  const models = await openWakeWordModels();
  let best = 0;
  let failure = null as string | null;
  const engine = new OpenWakeWordEngine({ keyword: 'jarvis', sensitivity: 0 }, async () => models);
  const controller = engine.start({
    onDetected: () => undefined,
    onScore: (score) => {
      best = Math.max(best, score);
    },
    onError: (message) => {
      failure = message;
    },
  });
  controller.pushAudio?.(pcm, sampleRate);
  await controller.idle();
  controller.stop();
  if (failure) throw new Error(failure);
  return best;
}

const SPEECH_RMS = 0.02;
const SILENCE_RMS = 0.012;
const STOP_AFTER_SILENCE_MS = 1500;

async function openMicrophoneProbe(deviceId: string | undefined): Promise<MicrophoneProbe> {
  let recording: Float32Array[] | null = null;
  let rate = 16000;
  let label = '';
  let heardSpeech = false;
  let silentMs = 0;
  let finish: (() => void) | null = null;
  const handle = await startAudioCapture(deviceId, {
    onFrame: (frame, sampleRate) => {
      rate = sampleRate;
      if (!recording) return;
      recording.push(frame);
      const rms = computeRms(frame);
      if (rms >= SPEECH_RMS) heardSpeech = true;
      silentMs = rms < SILENCE_RMS ? silentMs + (frame.length / sampleRate) * 1000 : 0;
      if (heardSpeech && silentMs >= STOP_AFTER_SILENCE_MS) finish?.();
    },
    onError: () => undefined,
  });
  label = handle.label;
  if (!label) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === 'audioinput');
      label = inputs.find((device) => device.deviceId === (handle.deviceId || deviceId))?.label ?? '';
    } catch {
      label = '';
    }
  }
  return {
    label,
    record: async (maxMs) => {
      recording = [];
      heardSpeech = false;
      silentMs = 0;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, maxMs);
        finish = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      finish = null;
      const frames = recording;
      recording = null;
      return { pcm: concatFloat32(frames), sampleRate: rate };
    },
    close: () => handle.stop(),
  };
}

export function createVoiceDiagnosticDeps(
  voice: VoiceSettings,
  onPrompt: (message: string | null) => void,
  deviceId: () => string | undefined = () => voice.microphoneId || undefined,
): VoiceDiagnosticDeps {
  return {
    assetsReport: () => window.jarvis.voice.assetsReport(),
    fetch: (input, init) => fetch(input, init),
    runtimeVersion: onnxRuntimeVersion,
    startRuntime: async () => {
      const ort = await configureOnnxRuntime();
      const response = await fetch(voiceAssetUrl('openwakeword', 'melspectrogram.onnx'));
      if (!response.ok) throw new Error(`HTTP ${response.status} pour melspectrogram.onnx`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await withOrtLock(async () => {
        const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
        await session.release();
      });
    },
    scoreWakeWord: (pcm, sampleRate) => scoreWakeWordClip(pcm, sampleRate),
    loadWhisper: async () => {
      try {
        await getWhisperPipeline({ force: true });
      } catch (error) {
        throw new Error(describeWhisperLoadError(error));
      }
    },
    transcribe: async (pcm, language, maxNewTokens) => {
      try {
        return await transcribeWithWhisper(pcm, { language, maxNewTokens });
      } catch (error) {
        throw new Error(describeWhisperLoadError(error));
      }
    },
    openMicrophone: () => openMicrophoneProbe(deviceId()),
    now: () => performance.now(),
    stepTimeoutMs: 45_000,
    whisperTimeoutMs: WHISPER_LOAD_TIMEOUT_MS + 10_000,
    liveRecordMs: 12_000,
    wakeWord: voice.wakeWord,
    wakeWordVariants: voice.wakeWordVariants,
    sensitivity: voice.wakeWordSensitivity,
    detectorConfig:
      voice.wakeWordProfiles.length > 0
        ? {
            profiles: voice.wakeWordProfiles.map((envelope) => ({ envelope })),
            matchStrategy: voice.wakeWordMatchStrategy,
          }
        : null,
    onPrompt,
  };
}

export interface AudioFileAnalysis {
  name: string;
  durationS: number;
  analysis: RecordingAnalysis;
}

/** « Analyser un fichier audio » : la même chaîne que le micro, sur un WAV / MP3 entier. */
export async function analyzeAudioFile(file: File, voice: VoiceSettings): Promise<AudioFileAnalysis> {
  let pcm: Float32Array;
  try {
    pcm = await decodeAudioToMono16k(await file.arrayBuffer());
  } catch {
    throw new Error(`Impossible de lire « ${file.name} ». Utilise un WAV ou un MP3.`);
  }
  const deps = createVoiceDiagnosticDeps(voice, () => undefined);
  try {
    await getWhisperPipeline();
  } catch (error) {
    throw new Error(describeWhisperLoadError(error));
  }
  return {
    name: file.name,
    durationS: pcm.length / VOICE_SAMPLE_RATE,
    analysis: await analyzeRecording({ pcm, sampleRate: VOICE_SAMPLE_RATE }, deps),
  };
}
