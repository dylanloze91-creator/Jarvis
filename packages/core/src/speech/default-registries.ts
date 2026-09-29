import { OpenAISttProvider, openAISttDescriptor } from './openai-stt.js';
import { OpenAITtsProvider, openAITtsDescriptor } from './openai-tts.js';
import { SpeechToTextRegistry, TextToSpeechRegistry } from './registry.js';

/**
 * Registres par défaut, côté cœur : seuls les moteurs distants (OpenAI) y
 * figurent, puisqu'ils n'ont besoin ni du DOM ni du micro. Le moteur local
 * (navigateur) est enregistré en plus par `apps/desktop`, qui seul a accès
 * au DOM ; voir `apps/desktop/src/renderer/src/voice/registries.ts`.
 */
export function createDefaultSttRegistry(): SpeechToTextRegistry {
  return new SpeechToTextRegistry().register(
    openAISttDescriptor,
    (config) => new OpenAISttProvider(config),
  );
}

export function createDefaultTtsRegistry(): TextToSpeechRegistry {
  return new TextToSpeechRegistry().register(
    openAITtsDescriptor,
    (config) => new OpenAITtsProvider(config),
  );
}
