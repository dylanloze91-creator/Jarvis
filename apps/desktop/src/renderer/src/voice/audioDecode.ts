import { resampleLinear } from '@jarvis/core';

export const VOICE_SAMPLE_RATE = 16_000;

export function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      out[index] = (out[index] ?? 0) + (data[index] ?? 0) / channels;
    }
  }
  return out;
}

/** WAV / MP3 / piste YouTube → PCM mono 16 kHz (le débit de Whisper et d'openWakeWord). */
export async function decodeAudioToMono16k(bytes: ArrayBuffer | Uint8Array): Promise<Float32Array> {
  const copy = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes.slice(0);
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(copy);
    return resampleLinear(mixToMono(decoded), decoded.sampleRate, VOICE_SAMPLE_RATE);
  } finally {
    await context.close();
  }
}
