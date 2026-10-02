export * from './types.js';
export * from './settings.js';
export * from './personalization/index.js';
export * from './knowledge/index.js';

export * from './providers/types.js';
export { MockProvider, mockDescriptor } from './providers/mock.js';
export { OpenAIProvider, openAIDescriptor } from './providers/openai.js';
export { AnthropicProvider, anthropicDescriptor } from './providers/anthropic.js';
export { ProviderRegistry, createDefaultRegistry } from './providers/registry.js';

export {
  OllamaProvider,
  ollamaDescriptor,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_RECOMMENDED_MODEL,
  OLLAMA_FALLBACK_MODEL,
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
  TOOL_OUTCOME_KINDS,
  classifyThrownError,
  outcomeFromResult,
  presentUserContent,
  toolFailure,
  toolSuccess,
  type ClassifiedToolFailure,
} from './tools/outcome.js';
export { redactSecrets, redactValue } from './security/redact.js';
export { debugLog } from './security/debugLog.js';
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

export {
  Agent,
  CURRENT_INFO_TOOL_NAME,
  DEFAULT_SYSTEM_PROMPT,
  HARD_TOOL_ROUND_CAP,
  composeSystemPrompt,
  isSpotifyToolName,
  looksLikeWebResearchIntent,
  temperatureForTurn,
  type AgentEvent,
  type AgentOptions,
} from './agent/agent.js';
export {
  VOICE_TRANSCRIPTION_NOTICE,
  withVoiceOriginNotice,
  type MessageOrigin,
} from './agent/voiceOriginNotice.js';

export * from './search/types.js';
export { WikipediaSearchProvider, wikipediaDescriptor } from './search/providers/wikipedia.js';
export { GoogleSearchProvider, googleDescriptor } from './search/providers/google.js';
export { BraveSearchProvider, braveDescriptor } from './search/providers/brave.js';
export {
  SearchProviderRegistry,
  createDefaultSearchRegistry,
  createWebSearchRegistry,
} from './search/registry.js';
export {
  DuckDuckGoSearchProvider,
  duckDuckGoDescriptor,
  isDuckDuckGoChallenge,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  unwrapDuckDuckGoHref,
} from './search/providers/duckduckgo.js';
export { BingSearchProvider, bingDescriptor, parseBingHtml, unwrapBingHref } from './search/providers/bing.js';
export {
  BingNewsRssProvider,
  GoogleNewsRssProvider,
  bingNewsDescriptor,
  googleNewsDescriptor,
  parseRssItems,
  unwrapBingNewsLink,
} from './search/providers/newsRss.js';
export { TavilySearchProvider, tavilyDescriptor } from './search/providers/tavily.js';
export {
  OPEN_METEO_LABEL,
  describeWeatherCode,
  fetchOpenMeteoWeather,
  localTimeToIso,
} from './search/providers/openMeteo.js';
export {
  KEYLESS_NEWS_ORDER,
  KEYLESS_WEB_ORDER,
  dedupeResults,
  describeAttempts,
  newsProviderOrder,
  searchWithFallback,
  webProviderOrder,
  type ChainSearchOptions,
  type ChainedSearchResponse,
  type SearchAttempt,
} from './search/chain.js';
export {
  formatCurrentSearchForModel,
  searchCurrentInfo,
  sourceLabel,
  type CurrentSearchDeps,
  type CurrentSearchRequest,
  type CurrentSearchResult,
  type CurrentSource,
} from './search/currentSearch.js';
export {
  ageInDays,
  formatCurrentDateTime,
  formatSourceDate,
  leadingSnippetDate,
  localTimeZone,
  parseFeedDate,
} from './search/dates.js';
export { filterRelevant, relevanceScore, significantTokens } from './search/relevance.js';
export {
  NEWS_HEADLINES_QUERY,
  detectCurrentInfoIntent,
  extractCity,
  isCurrentInfoQuestion,
  type CurrentInfoKind,
  type CurrentInfoPlan,
} from './agent/currentInfo.js';
export {
  CURRENT_INFO_TURN_PROMPT,
  citedSources,
  currentDatePrompt,
  currentInfoFailureReply,
  formatSourcesFooter,
  stripSourcesFooter,
} from './agent/citations.js';

export * from './media/types.js';
export { extractSpotifyPlayQuery, isMusicIntent, searchQueryVariants } from './media/playIntent.js';

export {
  DEFAULT_SITEBLOCK_BASE_URL,
  SITEBLOCK_TIME_PATTERN,
  checkSiteBlockBaseUrl,
  type SiteBlockUrlCheck,
} from './siteblock/url.js';
export {
  extractSiteBlockIntent,
  normalizeSiteBlockDomain,
  type SiteBlockToolPlan,
} from './siteblock/intent.js';
export { SITEBLOCK_SYSTEM_PROMPT_FRAGMENT, withSiteBlockPrompt } from './siteblock/prompt.js';

export * from './market/types.js';
export {
  YahooFinanceMarketDataProvider,
  yahooFinanceDescriptor,
} from './market/providers/yahooFinance.js';
export { FinnhubMarketDataProvider, finnhubDescriptor } from './market/providers/finnhub.js';
export { MarketDataProviderRegistry, createDefaultMarketDataRegistry } from './market/registry.js';

export { extractYoutubeUrl, parseYoutubeVideoId } from './youtube/url.js';
export {
  NO_CAPTIONS_ERROR,
  captionTracksFromPlayer,
  fetchYoutubeTranscript,
  loadYoutubePlayer,
  orderCaptionTracks,
  parseCaptionPayload,
  pickCaptionTrack,
  readBestCaption,
  titleFromPlayer,
} from './youtube/captions.js';
export { listAudioOnlyFormats, pickAudioOnlyFormat } from './youtube/audioFormat.js';
export { splitTranscript } from './youtube/chunk.js';
export { IMPORTANCE_RUBRIC, chunkPrompt, mergePrompt } from './youtube/rubric.js';
export { detectVideoDomain, FINANCE_DISCLAIMER, type VideoDomain } from './youtube/domain.js';
export { formatMediaTimestamp, joinTimedParts, type TimedTranscriptPart } from './youtube/timed.js';
export { dropSentencesWithInventedNumbers, numbersIn } from './youtube/numbers.js';
export { condenseTranscript, type TextComplete } from './youtube/summarize.js';
export {
  CAPTION_FALLBACK_NOTICE,
  summarizeYoutubeVideo,
  type YoutubeSummaryDeps,
} from './youtube/listen.js';
export { resolveLocalSummaryModel } from './youtube/localModel.js';
export {
  buildVideoMemory,
  classifyClaim,
  formatVideoAnalysis,
  formatVideoMemory,
  importanceBand,
  scoreSegment,
  scoreTranscript,
  visionHook,
  type Claim,
  type ClaimKind,
  type ScoredSegment,
  type VideoMemoryRecord,
  type VisionHook,
} from './youtube/analysis.js';

export { extractReadableText, type ReadablePage } from './web/readableText.js';
export { checkUrlSafety, isPrivateIpAddress, type UrlSafetyResult } from './web/urlSafety.js';
export {
  RETRYABLE_HTTP_STATUSES,
  fetchPublicText,
  frenchHttpMessage,
  httpOutcome,
  isRetryableHttpStatus,
  retryAfterMs,
  type FetchTextResult,
} from './web/resilientFetch.js';
export {
  assessHtml,
  compareSources,
  dedupeHits,
  formatClaimLabels,
  normalizeResearchUrl,
  researchDomain,
  selectSources,
  type ReadSource,
  type ResearchBrief,
  type ResearchHit,
} from './web/research.js';

export { classifyUpdateError } from './update/errorClassifier.js';
export {
  compareSemver,
  githubLatestYmlUrl,
  interpretLatestYmlResponse,
  parseLatestYmlVersion,
  GITHUB_UPDATES_OWNER,
  GITHUB_UPDATES_REPO,
  type UpdateFeedInterpretation,
  type UpdateFeedKind,
} from './update/feed.js';
export type { UpdateFailure, UpdateFailureKind } from './update/types.js';

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
export { concatFloat32, encodeWav, decodeWav, type DecodedWav } from './speech/wav.js';
export {
  isWhisperHallucination,
  normalizeForWakeWordMatch,
  levenshteinDistance,
  defaultWakeWordVariants,
  matchesWakeWord,
  stripLeadingWakeWord,
  commandAfterWakeWord,
  type WakeWordTextMatchConfig,
} from './speech/wakeWordTextMatch.js';
export {
  evaluateWakeWordWindow,
  peakEnergy,
  speechDurationMs,
  defaultWakeWordTranscriptionGateOptions,
  type TranscribeWindow,
  type WakeWordTranscriptionGateOptions,
  type WakeWordTranscriptionResult,
} from './speech/wakeWordFromTranscript.js';
export { WHISPER_WAKE_WORD_LANGUAGE, WHISPER_DICTATION_LANGUAGE } from './speech/whisperModels.js';
export {
  VOICE_ASSETS_PROTOCOL,
  VOICE_ASSET_HOSTS,
  ORT_WASM_MJS,
  ORT_WASM_BINARY,
  WHISPER_MODEL_REPO,
  WHISPER_LOCAL_MODEL_ROOT,
  OPENWAKEWORD_MODEL_FILES,
  REQUIRED_VOICE_ASSETS,
  VOSK_MODEL_ARCHIVE,
  VOSK_MODEL_NAME,
  parseVoiceAssetUrl,
  voiceAssetContentType,
  voiceAssetUrl,
  type OpenWakeWordModelFile,
  type VoiceAssetHost,
  type VoiceAssetKind,
  type VoiceAssetSpec,
} from './speech/voiceAssets.js';
export {
  VOSK_JARVIS_DECOYS,
  voskGrammar,
  voskMinConfidence,
  voskWakeHits,
  voskWakeWindow,
  type VoskWord,
} from './speech/voskWakeWord.js';
export {
  wrapWakeWordEngineWithTranscriptConfirmation,
  confirmWakeWordCandidate,
  type ConfirmWakeWordCandidateResult,
  type TranscriptConfirmationOptions,
} from './speech/confirmWakeWordCandidate.js';
export {
  wrapWakeWordEngineWithLoadFallback,
  type WakeWordLoadFallbackOptions,
} from './speech/wakeWordLoadFallback.js';
export {
  OPENWAKEWORD_FRAME_SIZE,
  OPENWAKEWORD_SAMPLE_RATE,
  OPENWAKEWORD_INT16_SCALE,
  OPENWAKEWORD_MEL_BINS,
  OPENWAKEWORD_MEL_CONTEXT,
  OPENWAKEWORD_MEL_WINDOW,
  OpenWakeWordMelStream,
  openWakeWordSensitivityToThreshold,
  describeOpenWakeWordLoadError,
  resampleLinear,
  scaleOpenWakeWordPcm,
  takeFixedFrames,
} from './speech/openWakeWord.js';
export {
  CAPTURE_DEVICE_LOST_ERROR,
  CAPTURE_NO_AUDIO_ERROR,
  CAPTURE_TIMEOUT_ERROR,
  CAPTURE_UNSUPPORTED_ERROR,
  COMMUNICATIONS_INPUT_ID,
  DEFAULT_INPUT_ID,
  actionOnDeviceChange,
  captureConstraints,
  captureFailureCause,
  captureFailureText,
  describeCaptureFailure,
  formatCaptureTimings,
  formatSeconds,
  isSystemDefaultInput,
  recoveryDelayMs,
  redactDeviceId,
  resolveCaptureTarget,
  shouldFallbackToDefault,
  withoutDefaultPrefix,
  type CaptureFailure,
  type CaptureStep,
  type CaptureTarget,
  type CaptureTimings,
  type DeviceChangeAction,
  type MediaTrackConstraintsLike,
} from './speech/microphoneCapture.js';
export {
  ATTENUATED_PEAK,
  FULL_SCALE_PEAK,
  attenuateClipping,
  type AttenuatedPcm,
} from './speech/voiceGain.js';
export {
  LoopbackInputError,
  chooseMicrophone,
  isLoopbackOrMixInput,
  loopbackInputMessage,
  microphoneOptionLabel,
  windowsDefaultInput,
  type AudioInputOption,
  type MicrophoneChoice,
} from './speech/audioInput.js';
export {
  CircularPcmBuffer,
  WakeTriggerGate,
  slidingWindows,
} from './speech/wakeBuffer.js';
export {
  WakeWordDetector,
  SpeechBurstDetector,
  averageProfiles,
  buildWakeWordProfile,
  buildWakeWordProfileFromPcm,
  buildWakeWordProfilesFromPcm,
  buildWakeWordProfileFromEnergyFrames,
  energyFramesFromPcm,
  extractSpeechBurstRanges,
  paddedEnergyWindow,
  zeroCrossingRate,
  computeRms,
  defaultWakeWordOptions,
  sensitivityToThreshold,
  thresholdToSensitivity,
  SENSITIVITY_THRESHOLD_RANGE,
  WAKE_WORD_PROFILE_LENGTH,
  WAKE_WORD_BURST_DURATION_MS,
  WAKE_WORD_SPEECH_ZCR,
  type WakeWordProfile,
  type WakeWordProfileFromPcmResult,
  type WakeWordProfilesFromPcmResult,
  type WakeWordClipRejectReason,
  type SpeechBurstRange,
  type WakeWordDetectorConfig,
  type WakeWordDetectorOptions,
  type WakeWordMatchStrategy,
} from './speech/wakeword.js';
export {
  LocalTemplateWakeWordEngine,
  createLocalTemplateWakeWordEngine,
  splitWakeWordWindow,
  type WakeWordWindow,
  type WakeWordEngine,
  type WakeWordEngineConfig,
  type WakeWordEngineController,
  type WakeWordEngineHandlers,
} from './speech/wakewordEngine.js';
export * from './speech/wakeLearning/index.js';
export * from './speech/endOfSpeech.js';
export {
  ConversationSession,
  FOLLOW_UP_WINDOW_MS,
  WAKE_GRACE_MS,
  classifySpokenTurn,
  isConversationStop,
  type ConversationPhase,
  type SpokenTurnDecision,
} from './speech/conversationSession.js';
export * from './google/index.js';
export * from './developer/index.js';
