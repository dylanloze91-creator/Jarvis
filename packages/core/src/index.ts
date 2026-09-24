export * from './types.js';
export * from './settings.js';

export * from './providers/types.js';
export { MockProvider, mockDescriptor } from './providers/mock.js';
export { OpenAIProvider, openAIDescriptor } from './providers/openai.js';
export { AnthropicProvider, anthropicDescriptor } from './providers/anthropic.js';
export { ProviderRegistry, createDefaultRegistry } from './providers/registry.js';

export {
  OllamaProvider,
  ollamaDescriptor,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_RECOMMENDED_NUM_CTX,
  detectLeakedToolCallAttempt,
  type LeakedToolCallAttempt,
} from './providers/ollama.js';
export {
  checkOllamaStatus,
  normalizeBaseUrl as normalizeOllamaBaseUrl,
  type OllamaServerStatus,
  type OllamaModelInfo,
  type OllamaStatusResult,
  type FetchLike as OllamaFetchLike,
} from './providers/ollamaStatus.js';
export {
  OLLAMA_RTX2060_6GB_RECOMMENDATIONS,
  OLLAMA_TOOL_CATALOG_FOOTPRINT,
  getOllamaDefaultRecommendation,
  type OllamaModelRecommendation,
  type OllamaRecommendationRole,
} from './providers/ollamaModels.js';
export {
  testOllamaConnection,
  type OllamaDiagnosticResult,
  type OllamaDiagnosticStep,
  type OllamaDiagnosticStepId,
  type TestOllamaConnectionOptions,
} from './providers/ollamaDiagnostics.js';

export * from './tools/types.js';
export { ToolManager, defineTool } from './tools/manager.js';
export {
  defaultCategoryPolicies,
  categoryLabels,
  policyLabels,
  CONFIGURABLE_CATEGORIES,
  requiresConfirmation,
  parseCategoryPolicies,
} from './tools/permissions.js';

export * from './audit/types.js';
export { buildAuditEntry, InMemoryAuditLogStore } from './audit/log.js';

export { Agent, DEFAULT_SYSTEM_PROMPT, type AgentEvent, type AgentOptions } from './agent/agent.js';
export {
  VOICE_TRANSCRIPTION_NOTICE,
  withVoiceOriginNotice,
  type MessageOrigin,
} from './agent/voiceOriginNotice.js';

export * from './search/types.js';
export { WikipediaSearchProvider, wikipediaDescriptor } from './search/providers/wikipedia.js';
export { BraveSearchProvider, braveDescriptor } from './search/providers/brave.js';
export { SearchProviderRegistry, createDefaultSearchRegistry } from './search/registry.js';

export * from './market/types.js';
export {
  YahooFinanceMarketDataProvider,
  yahooFinanceDescriptor,
} from './market/providers/yahooFinance.js';
export { FinnhubMarketDataProvider, finnhubDescriptor } from './market/providers/finnhub.js';
export { MarketDataProviderRegistry, createDefaultMarketDataRegistry } from './market/registry.js';

export { extractReadableText, type ReadablePage } from './web/readableText.js';
export { checkUrlSafety, isPrivateIpAddress, type UrlSafetyResult } from './web/urlSafety.js';

export {
  InMemoryConversationStore,
  newConversation,
  summarize,
  withMessages,
  type ConversationStore,
} from './history/store.js';

export * from './speech/types.js';
export { SpeechToTextRegistry, TextToSpeechRegistry } from './speech/registry.js';
export {
  createDefaultSttRegistry,
  createDefaultTtsRegistry,
  createDefaultWakeWordEngineRegistry,
} from './speech/default-registries.js';
export { OpenAISttProvider, openAISttDescriptor } from './speech/openai-stt.js';
export { OpenAITtsProvider, openAITtsDescriptor, OPENAI_TTS_VOICES } from './speech/openai-tts.js';
export { concatFloat32, encodeWav, decodeWav, type DecodedWav } from './speech/wav.js';
export {
  normalizeForWakeWordMatch,
  levenshteinDistance,
  defaultWakeWordVariants,
  matchesWakeWord,
  stripLeadingWakeWord,
  type WakeWordTextMatchConfig,
} from './speech/wakeWordTextMatch.js';
export {
  evaluateWakeWordWindow,
  peakEnergy,
  defaultWakeWordTranscriptionGateOptions,
  type TranscribeWindow,
  type WakeWordTranscriptionGateOptions,
  type WakeWordTranscriptionResult,
} from './speech/wakeWordFromTranscript.js';
export {
  WHISPER_STT_MODELS,
  WHISPER_WAKE_WORD_MODEL,
  WHISPER_WAKE_WORD_LANGUAGE,
  DEFAULT_WHISPER_STT_MODEL_ID,
  findWhisperModel,
  type WhisperModelOption,
} from './speech/whisperModels.js';
export {
  WakeWordDetector,
  averageProfiles,
  buildWakeWordProfile,
  computeRms,
  defaultWakeWordOptions,
  sensitivityToThreshold,
  thresholdToSensitivity,
  SENSITIVITY_THRESHOLD_RANGE,
  WAKE_WORD_PROFILE_LENGTH,
  type WakeWordProfile,
  type WakeWordDetectorConfig,
  type WakeWordDetectorOptions,
  type WakeWordMatchStrategy,
} from './speech/wakeword.js';
export {
  WakeWordEngineRegistry,
  LocalTemplateWakeWordEngine,
  createLocalTemplateWakeWordEngine,
  localTemplateWakeWordDescriptor,
  type WakeWordEngine,
  type WakeWordEngineConfig,
  type WakeWordEngineController,
  type WakeWordEngineDescriptor,
  type WakeWordEngineFactory,
  type WakeWordEngineHandlers,
} from './speech/wakewordEngine.js';
