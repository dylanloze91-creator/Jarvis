import {
  SpeechToTextRegistry,
  TextToSpeechRegistry,
  WHISPER_DICTATION_LANGUAGE,
  WHISPER_WAKE_WORD_LANGUAGE,
  createLocalTemplateWakeWordEngine,
  openAISttDescriptor,
  openAITtsDescriptor,
  wrapWakeWordEngineWithLoadFallback,
  wrapWakeWordEngineWithTranscriptConfirmation,
  type WakeWordEngine,
  type WakeWordEngineConfig,
} from '@jarvis/core';
import { LocalBrowserTtsProvider, localTtsDescriptor } from './localTts';
import { LocalWhisperSttProvider, localWhisperSttDescriptor } from './localWhisperStt';
import { OpenWakeWordEngine } from './openWakeWordEngine';
import { IpcSttProvider, IpcTtsProvider } from './remote';
import { WAKE_WORD_MAX_NEW_TOKENS, transcribeWithWhisper } from './whisper/pipelineLoader';

/**
 * Registres côté renderer. Un seul moteur local de reconnaissance : Whisper
 * (`LocalWhisperSttProvider`), le même que celui qui confirme le mot de
 * réveil et écoute les vidéos YouTube. OpenAI reste proposé à part (clé
 * requise, jamais un repli). La reconnaissance intégrée du navigateur n'est
 * pas enregistrée : elle dépend de serveurs Google absents d'Electron.
 */
export function createSttRegistry(): SpeechToTextRegistry {
  return new SpeechToTextRegistry()
    .register(localWhisperSttDescriptor, () => new LocalWhisperSttProvider())
    .register(openAISttDescriptor, () => new IpcSttProvider());
}

export function createTtsRegistry(): TextToSpeechRegistry {
  return new TextToSpeechRegistry()
    .register(localTtsDescriptor, () => new LocalBrowserTtsProvider())
    .register(openAITtsDescriptor, () => new IpcTtsProvider());
}

/** Gabarit d'énergie confirmé par Whisper : le déclencheur « Jarvis » nu. */
function createBareJarvisTrigger(config: WakeWordEngineConfig): WakeWordEngine {
  return wrapWakeWordEngineWithTranscriptConfirmation(createLocalTemplateWakeWordEngine(config), {
    transcribe: (pcm) =>
      transcribeWithWhisper(pcm, {
        language: WHISPER_WAKE_WORD_LANGUAGE,
        maxNewTokens: WAKE_WORD_MAX_NEW_TOKENS,
      }),
    secondOpinion: (pcm) =>
      transcribeWithWhisper(pcm, {
        language: WHISPER_DICTATION_LANGUAGE,
        maxNewTokens: WAKE_WORD_MAX_NEW_TOKENS,
      }),
    word: config.keyword ?? 'jarvis',
    variants: config.variants ?? [],
    acceptOnTranscriptionError: false,
  });
}

/**
 * Le seul chemin du mot de réveil : openWakeWord (modèle officiel
 * « hey jarvis ») et, en parallèle dès le départ, le déclencheur « Jarvis »
 * nu. Si openWakeWord ne charge pas, le déclencheur continue seul.
 */
export function createWakeWordEngine(config: WakeWordEngineConfig): WakeWordEngine {
  return wrapWakeWordEngineWithLoadFallback(
    new OpenWakeWordEngine(config),
    () => createBareJarvisTrigger(config),
    { alwaysOn: true },
  );
}
