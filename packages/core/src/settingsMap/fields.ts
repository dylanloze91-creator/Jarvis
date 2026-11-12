import type { SettingsCategoryId } from './categories.js';
import { ORCHESTRA_TEAMS } from '../agent/orchestraTeams.js';
import { SPECIALIST_ROLES } from '../developer/engine/roles.js';

export interface SettingsFieldLocation {
  category: SettingsCategoryId;
  subcategory: string;
  highlight?: string;
}

const orchestraTeamPaths = (): Record<string, SettingsFieldLocation> => {
  const map: Record<string, SettingsFieldLocation> = {};
  for (const team of ORCHESTRA_TEAMS) {
    map[`orchestra.teams.${team}.model`] = {
      category: 'brain',
      subcategory: 'orchestra',
      highlight: `orchestra-team-${team}`,
    };
    map[`orchestra.teams.${team}.place`] = {
      category: 'brain',
      subcategory: 'orchestra',
      highlight: `orchestra-team-${team}`,
    };
  }
  return map;
};

const developerRoleModelPaths = (): Record<string, SettingsFieldLocation> => {
  const map: Record<string, SettingsFieldLocation> = {};
  for (const role of SPECIALIST_ROLES) {
    map[`developer.roleModels.${role}`] = {
      category: 'services',
      subcategory: 'developer-advanced',
      highlight: 'roleModels',
    };
  }
  return map;
};

/** Chaque chemin de réglage (dot notation) dans la carte 5.0.70. */
export const SETTINGS_FIELD_MAP: Record<string, SettingsFieldLocation> = {
  provider: { category: 'brain', subcategory: 'provider' },
  model: { category: 'brain', subcategory: 'model', highlight: 'model' },
  apiKey: { category: 'brain', subcategory: 'provider', highlight: 'apiKey' },
  baseUrl: { category: 'brain', subcategory: 'provider', highlight: 'baseUrl' },
  hotkey: { category: 'application', subcategory: 'window', highlight: 'hotkey' },
  systemPrompt: { category: 'brain', subcategory: 'system-prompt', highlight: 'systemPrompt' },
  temperature: { category: 'brain', subcategory: 'model', highlight: 'temperature' },
  fallbackModel: { category: 'brain', subcategory: 'model', highlight: 'fallbackModel' },
  debugLogging: { category: 'brain', subcategory: 'model', highlight: 'debugLogging' },
  searchProvider: { category: 'brain', subcategory: 'search', highlight: 'searchProvider' },
  searchApiKey: { category: 'brain', subcategory: 'search', highlight: 'searchApiKey' },
  googleCseId: { category: 'brain', subcategory: 'search', highlight: 'googleCseId' },
  marketDataProvider: { category: 'brain', subcategory: 'market', highlight: 'marketDataProvider' },
  marketDataApiKey: { category: 'brain', subcategory: 'market', highlight: 'marketDataApiKey' },
  spotifyClientId: { category: 'services', subcategory: 'spotify', highlight: 'spotifyClientId' },
  spotifyDeviceName: { category: 'services', subcategory: 'spotify', highlight: 'spotifyDeviceName' },
  spotifyAskDevice: { category: 'services', subcategory: 'spotify', highlight: 'spotifyAskDevice' },
  speakerVoice: { category: 'services', subcategory: 'speakers', highlight: 'speaker-voice' },
  speakerPreloadWhisper: { category: 'services', subcategory: 'speakers', highlight: 'speaker-preload' },
  speakerWarmup: { category: 'services', subcategory: 'speakers', highlight: 'speaker-warmup' },
  speakerRulesAddressee: { category: 'services', subcategory: 'speakers', highlight: 'speaker-rules' },
  speakerKeepAwake: { category: 'services', subcategory: 'speakers', highlight: 'speaker-awake' },
  speakerFastMode: { category: 'services', subcategory: 'speakers', highlight: 'speaker-fast' },
  spotifySpeakerMaxVolume: { category: 'services', subcategory: 'spotify', highlight: 'spotifySpeakerMaxVolume' },
  googleClientId: { category: 'services', subcategory: 'google', highlight: 'googleClientId' },
  googleClientSecret: { category: 'services', subcategory: 'google', highlight: 'googleClientSecret' },
  googleAccess: { category: 'services', subcategory: 'google', highlight: 'googleAccess' },
  siteBlockBaseUrl: { category: 'services', subcategory: 'siteblock', highlight: 'siteBlockBaseUrl' },
  siteBlockToken: { category: 'services', subcategory: 'siteblock', highlight: 'siteBlockToken' },
  roverBaseUrl: { category: 'services', subcategory: 'robot', highlight: 'roverBaseUrl' },
  roverToken: { category: 'services', subcategory: 'robot', highlight: 'roverToken' },
  'images.enabled': { category: 'services', subcategory: 'images', highlight: 'images' },
  'images.forgeDir': { category: 'services', subcategory: 'images', highlight: 'images' },
  'images.forgeUrl': { category: 'services', subcategory: 'images', highlight: 'images' },
  'images.outputRoot': { category: 'services', subcategory: 'images', highlight: 'images' },
  'images.keepForgeRunning': { category: 'services', subcategory: 'images', highlight: 'images' },
  'images.openAfterGeneration': { category: 'services', subcategory: 'images', highlight: 'images' },
  'images.refinePrompts': { category: 'services', subcategory: 'images', highlight: 'images' },
  'images.directHoldForge': { category: 'services', subcategory: 'images', highlight: 'images' },
  'images.directNoTxtPerso': { category: 'services', subcategory: 'images', highlight: 'images' },
  'notes.enabled': { category: 'moi', subcategory: 'notes', highlight: 'notes-enabled' },
  'routines.enabled': { category: 'services', subcategory: 'routines', highlight: 'routines-enabled' },
  'briefing.enabled': { category: 'moi', subcategory: 'briefing', highlight: 'briefing-enabled' },
  'briefing.fromHour': { category: 'moi', subcategory: 'briefing', highlight: 'briefing-hours' },
  'briefing.toHour': { category: 'moi', subcategory: 'briefing', highlight: 'briefing-hours' },
  'briefing.rainMmPerHour': { category: 'moi', subcategory: 'briefing', highlight: 'briefing-thresholds' },
  'briefing.gustKmh': { category: 'moi', subcategory: 'briefing', highlight: 'briefing-thresholds' },
  'homeLocation.label': { category: 'moi', subcategory: 'home-location', highlight: 'homeLocation' },
  'homeLocation.latitude': { category: 'moi', subcategory: 'home-location', highlight: 'homeLocation' },
  'homeLocation.longitude': { category: 'moi', subcategory: 'home-location', highlight: 'homeLocation' },
  stayVisibleOnBlur: { category: 'application', subcategory: 'window', highlight: 'stayVisibleOnBlur' },
  launchAtLogin: { category: 'application', subcategory: 'window', highlight: 'launchAtLogin' },
  videoAnalysis: { category: 'moi', subcategory: 'knowledge', highlight: 'videoAnalysis' },
  ollamaNumCtx: { category: 'brain', subcategory: 'ollama', highlight: 'ollamaNumCtx' },
  'toolPolicies.apps': { category: 'security', subcategory: 'tool-policies', highlight: 'toolPolicies-apps' },
  'toolPolicies.files': { category: 'security', subcategory: 'tool-policies', highlight: 'toolPolicies-files' },
  'toolPolicies.capture': { category: 'security', subcategory: 'tool-policies', highlight: 'toolPolicies-capture' },
  'toolPolicies.shell': { category: 'security', subcategory: 'tool-policies', highlight: 'toolPolicies-shell' },
  'voice.enabled': { category: 'parler', subcategory: 'voice', highlight: 'voice-enabled' },
  'voice.wakeWord': { category: 'parler', subcategory: 'voice', highlight: 'wakeWord' },
  'voice.wakeWordProfiles': { category: 'parler', subcategory: 'voice-advanced', highlight: 'wakeWordProfiles' },
  'voice.wakeWordMatchStrategy': { category: 'parler', subcategory: 'voice-advanced', highlight: 'wakeWordMatchStrategy' },
  'voice.wakeWordSensitivity': { category: 'parler', subcategory: 'voice-advanced', highlight: 'wakeWordSensitivity' },
  'voice.wakeWordVariants': { category: 'parler', subcategory: 'voice-advanced', highlight: 'wakeWordVariants' },
  'voice.wakeLearning': { category: 'parler', subcategory: 'voice-advanced', highlight: 'wakeLearning' },
  'voice.microphoneId': { category: 'parler', subcategory: 'voice', highlight: 'microphoneId' },
  'voice.sttProvider': { category: 'parler', subcategory: 'voice-advanced', highlight: 'sttProvider' },
  'voice.ttsProvider': { category: 'parler', subcategory: 'voice', highlight: 'ttsProvider' },
  'voice.ttsEnabled': { category: 'parler', subcategory: 'voice', highlight: 'ttsEnabled' },
  'voice.ttsVoice': { category: 'parler', subcategory: 'voice', highlight: 'ttsVoice' },
  'voice.apiKey': { category: 'parler', subcategory: 'voice-advanced', highlight: 'voice-apiKey' },
  'voice.followUpSeconds': { category: 'parler', subcategory: 'voice', highlight: 'followUpSeconds' },
  'voice.addresseeCheck': { category: 'parler', subcategory: 'voice', highlight: 'addresseeCheck' },
  'developer.enabled': { category: 'services', subcategory: 'developer-general', highlight: 'developer-enabled' },
  'developer.repoPath': { category: 'services', subcategory: 'developer-advanced', highlight: 'repoPath' },
  'developer.codeModel': { category: 'services', subcategory: 'developer-advanced', highlight: 'codeModel' },
  'developer.chatModel': { category: 'services', subcategory: 'developer-advanced', highlight: 'chatModel' },
  'developer.worktreeRoot': { category: 'services', subcategory: 'developer-advanced', highlight: 'worktreeRoot' },
  'developer.maxFixAttempts': { category: 'services', subcategory: 'developer-advanced', highlight: 'maxFixAttempts' },
  'developer.roleModels': { category: 'services', subcategory: 'developer-advanced', highlight: 'roleModels' },
  'developer.projectsRoot': { category: 'services', subcategory: 'developer-advanced', highlight: 'projectsRoot' },
  'developer.knowledgeManual': { category: 'services', subcategory: 'developer-advanced', highlight: 'knowledgeManual' },
  'developer.knowledgeLearning': { category: 'services', subcategory: 'developer-advanced', highlight: 'knowledgeLearning' },
  'developer.memoryRetrieval': { category: 'services', subcategory: 'developer-advanced', highlight: 'memoryRetrieval' },
  'developer.skillLibrary': { category: 'services', subcategory: 'developer-advanced', highlight: 'skillLibrary' },
  'developer.chatMissions': { category: 'services', subcategory: 'developer-general', highlight: 'chatMissions' },
  'developer.periodicWebResearch': { category: 'services', subcategory: 'developer-advanced', highlight: 'periodicWebResearch' },
  'developer.watchTopics': { category: 'services', subcategory: 'developer-advanced', highlight: 'watchTopics' },
  'localLearning.enabled': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-enabled' },
  'localLearning.activeOllamaModel': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-activeOllamaModel' },
  'localLearning.trainBaseModel': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-trainBaseModel' },
  'localLearning.lastTrainedAt': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-lastTrainedAt' },
  'localLearning.lastTrainExampleCount': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-lastTrainExampleCount' },
  'localLearning.statusHint': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-statusHint' },
  'localLearning.autoTrain': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-autoTrain' },
  'localLearning.previousOllamaModel': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-previousOllamaModel' },
  'localLearning.lastEvalNote': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-lastEvalNote' },
  'localLearning.pythonDepsReady': { category: 'moi', subcategory: 'knowledge', highlight: 'localLearning-pythonDepsReady' },
  'orchestra.enabled': { category: 'brain', subcategory: 'orchestra', highlight: 'orchestra-enabled' },
  'orchestra.brain': { category: 'brain', subcategory: 'orchestra', highlight: 'orchestra-brain' },
  'orchestra.router.model': { category: 'brain', subcategory: 'orchestra', highlight: 'orchestra-router' },
  'orchestra.router.place': { category: 'brain', subcategory: 'orchestra', highlight: 'orchestra-router' },
  'orchestra.trieurDataDir': { category: 'brain', subcategory: 'orchestra', highlight: 'trieurDataDir' },
  'orchestra.teamValidation': { category: 'brain', subcategory: 'orchestra', highlight: 'teamValidation' },
  'persona.enabled': { category: 'moi', subcategory: 'persona', highlight: 'persona-enabled' },
  'persona.style': { category: 'moi', subcategory: 'persona', highlight: 'persona-style' },
  'persona.humour': { category: 'moi', subcategory: 'persona', highlight: 'persona-humour' },
  'machine.profile': { category: 'application', subcategory: 'machine', highlight: 'machine-profile' },
  'machine.cpuOnly': { category: 'application', subcategory: 'machine', highlight: 'machine-cpuOnly' },
  'machine.measureFailed': { category: 'application', subcategory: 'machine', highlight: 'machine-measureFailed' },
  'machine.detected': { category: 'application', subcategory: 'machine', highlight: 'machine-detected' },
  'machine.chosen': { category: 'application', subcategory: 'machine', highlight: 'machine-chosen' },
  'backup.directory': { category: 'application', subcategory: 'backup', highlight: 'backup-directory' },
  'backup.frequency': { category: 'application', subcategory: 'backup', highlight: 'backup-frequency' },
  'backup.keep': { category: 'application', subcategory: 'backup', highlight: 'backup-keep' },
  'backup.includeTrainingData': { category: 'application', subcategory: 'backup', highlight: 'backup-training' },
  'backup.includeModels': { category: 'application', subcategory: 'backup', highlight: 'backup-models' },
  'backup.trainingDir': { category: 'application', subcategory: 'backup', highlight: 'backup-training' },
  'backup.modelsDir': { category: 'application', subcategory: 'backup', highlight: 'backup-models' },
  ...orchestraTeamPaths(),
  ...developerRoleModelPaths(),
};

/** Actions et blocs hors schéma qui doivent rester trouvables. */
export const SETTINGS_ACTION_MAP: Record<string, SettingsFieldLocation> = {
  'action.voice.test': { category: 'parler', subcategory: 'voice', highlight: 'voice-test' },
  'action.voice.wakeLearning': { category: 'parler', subcategory: 'voice-advanced', highlight: 'wakeLearning' },
  'action.voice.diagnostic': { category: 'parler', subcategory: 'voice-advanced', highlight: 'voice-diagnostic' },
  'action.google.connect': { category: 'services', subcategory: 'google', highlight: 'google-connect' },
  'action.spotify.devices': { category: 'services', subcategory: 'spotify', highlight: 'spotify-devices' },
  'action.phone.pair': { category: 'services', subcategory: 'phone', highlight: 'phone-pair' },
  'action.speaker.add': { category: 'services', subcategory: 'speakers', highlight: 'speaker-add' },
  'action.speaker.install': { category: 'services', subcategory: 'speakers', highlight: 'speaker-add' },
  'action.speaker.diagnose': { category: 'services', subcategory: 'speakers', highlight: 'speaker-diagnose' },
  'action.machine.analyze': { category: 'application', subcategory: 'machine', highlight: 'machine-analyze' },
  'action.updates.check': { category: 'application', subcategory: 'updates', highlight: 'updates-check' },
  'action.personalization.edit': { category: 'moi', subcategory: 'personalization', highlight: 'personalization' },
  'action.audit.view': { category: 'security', subcategory: 'audit', highlight: 'audit' },
  'action.questionnaire.retry': { category: 'application', subcategory: 'questionnaire', highlight: 'questionnaire-retry' },
  'action.questionnaire.restore': { category: 'application', subcategory: 'questionnaire', highlight: 'questionnaire-restore' },
  'action.health.open': { category: 'application', subcategory: 'health', highlight: 'health' },
  'action.health.refresh': { category: 'application', subcategory: 'health', highlight: 'health-refresh' },
  'action.backup.now': { category: 'application', subcategory: 'backup', highlight: 'backup-now' },
  'action.backup.restore': { category: 'application', subcategory: 'backup', highlight: 'backup-restore' },
  'action.know.export': { category: 'moi', subcategory: 'know', highlight: 'know-export' },
  'action.know.erase': { category: 'moi', subcategory: 'know', highlight: 'know-erase' },
  'state.phone': { category: 'services', subcategory: 'phone' },
  'state.speakers': { category: 'services', subcategory: 'speakers' },
  'state.personalization': { category: 'moi', subcategory: 'personalization' },
  'state.knowledge': { category: 'moi', subcategory: 'knowledge' },
};

export const ALL_SETTINGS_MAP_KEYS = [
  ...Object.keys(SETTINGS_FIELD_MAP),
  ...Object.keys(SETTINGS_ACTION_MAP),
] as const;
