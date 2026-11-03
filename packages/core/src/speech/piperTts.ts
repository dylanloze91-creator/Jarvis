import type { TextToSpeechDescriptor, VoiceDescriptor } from './types.js';
import { PIPER_TTS_ID, PIPER_VOICES } from './piper.js';

export const localPiperTtsDescriptor: TextToSpeechDescriptor = {
  id: PIPER_TTS_ID,
  label: 'Piper (voix locale gratuite, sans Internet)',
  requiresApiKey: false,
};

export function listPiperVoiceDescriptors(): VoiceDescriptor[] {
  return PIPER_VOICES.map((voice) => ({ id: voice.id, label: voice.label }));
}
