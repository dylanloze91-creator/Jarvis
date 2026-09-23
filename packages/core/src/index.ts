export * from './types.js';
export * from './settings.js';

export * from './providers/types.js';
export { MockProvider, mockDescriptor } from './providers/mock.js';
export { OpenAIProvider, openAIDescriptor } from './providers/openai.js';
export { AnthropicProvider, anthropicDescriptor } from './providers/anthropic.js';
export { ProviderRegistry, createDefaultRegistry } from './providers/registry.js';

export * from './tools/types.js';
export { ToolManager, defineTool } from './tools/manager.js';

export { Agent, DEFAULT_SYSTEM_PROMPT, type AgentEvent, type AgentOptions } from './agent/agent.js';

export {
  InMemoryConversationStore,
  newConversation,
  summarize,
  withMessages,
  type ConversationStore,
} from './history/store.js';

export * from './speech/types.js';
export { SpeechToTextRegistry, TextToSpeechRegistry } from './speech/registry.js';
export { createDefaultSttRegistry, createDefaultTtsRegistry } from './speech/default-registries.js';
export { OpenAISttProvider, openAISttDescriptor } from './speech/openai-stt.js';
export { OpenAITtsProvider, openAITtsDescriptor, OPENAI_TTS_VOICES } from './speech/openai-tts.js';
export { concatFloat32, encodeWav } from './speech/wav.js';
export {
  WakeWordDetector,
  buildWakeWordProfile,
  defaultWakeWordOptions,
  WAKE_WORD_PROFILE_LENGTH,
  type WakeWordProfile,
  type WakeWordDetectorOptions,
} from './speech/wakeword.js';
