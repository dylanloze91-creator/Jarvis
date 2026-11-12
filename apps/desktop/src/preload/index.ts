import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type ChatEvent,
  type GoogleConfigDraft,
  type ImagerDirectEvent,
  type HealthReport,
  type JarvisApi,
  type MachinePullProgress,
  type PhoneStatus,
  type SendChatInput,
  type SpeakerShowConversation,
  type SpeakerStatus,
  type SpeakerTranscribeRequest,
  type SpeakerTranscribeResult,
  type TeamValidationInput,
  type EditionClaimResult,
  type ReservedName,
  type UpdateState,
  type VoiceSpeakInput,
  type VoicePiperSpeakInput,
  type VoiceTranscribeInput,
  type WakeLearningSampleInput,
  type WindowChrome,
  type YoutubeTranscribeProgress,
  type YoutubeTranscribeRequest,
  type YoutubeTranscribeResult,
} from '../shared/ipc.js';
import type { LearningRecord, LocalLearningRuntimeStatus, Settings, WakeStatKind } from '@jarvis/core';
import { createDeveloperApi } from './developer.js';

/**
 * Seule surface exposée au renderer. Elle est volontairement étroite : pas
 * d'accès à `ipcRenderer` brut, pas de Node, uniquement ces appels typés.
 */
const claimListeners = new Set<(result: EditionClaimResult) => void>();

const api: JarvisApi = {
  chat: {
    send: (input: SendChatInput) => ipcRenderer.invoke(IpcChannel.chatSend, input),
    cancel: () => ipcRenderer.invoke(IpcChannel.chatCancel),
    respondConfirmation: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke(IpcChannel.confirmRespond, requestId, approved),
    launchMissionProposal: (input) => ipcRenderer.invoke(IpcChannel.chatMissionLaunch, input),
    declineMissionProposal: (input) => ipcRenderer.invoke(IpcChannel.chatMissionDecline, input),
    setMissionProposalProject: (input) => ipcRenderer.invoke(IpcChannel.chatMissionSetProject, input),
    patchMissionProposal: (input) => ipcRenderer.invoke(IpcChannel.chatMissionPatchProposal, input),
    openMissionFolder: (input) => ipcRenderer.invoke(IpcChannel.chatMissionOpenFolder, input),
    reloadConversationMissions: (conversationId: string) =>
      ipcRenderer.invoke(IpcChannel.chatMissionReload, conversationId),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: ChatEvent): void =>
        listener(payload);
      ipcRenderer.on(IpcChannel.chatEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.chatEvent, handler);
    },
  },
  orchestra: {
    validateTeam: (input: TeamValidationInput) =>
      ipcRenderer.invoke(IpcChannel.orchestraValidateTeam, input),
  },
  images: {
    open: (path: string) => ipcRenderer.invoke(IpcChannel.imagesOpen, path),
    directCatalog: () => ipcRenderer.invoke(IpcChannel.imagesDirectCatalog),
    directGenerate: (request: unknown) => ipcRenderer.invoke(IpcChannel.imagesDirectGenerate, request),
    directCancel: () => ipcRenderer.invoke(IpcChannel.imagesDirectCancel),
    directPanel: (open: boolean) => ipcRenderer.invoke(IpcChannel.imagesDirectPanel, open),
    onDirectEvent: (listener: (event: ImagerDirectEvent) => void) => {
      const handler = (_event: unknown, payload: ImagerDirectEvent) => listener(payload);
      ipcRenderer.on(IpcChannel.imagesDirectEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.imagesDirectEvent, handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannel.settingsGet),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke(IpcChannel.settingsSet, patch),
    providers: () => ipcRenderer.invoke(IpcChannel.settingsProviders),
    searchProviders: () => ipcRenderer.invoke(IpcChannel.settingsSearchProviders),
    marketDataProviders: () => ipcRenderer.invoke(IpcChannel.settingsMarketDataProviders),
    ollamaStatus: (baseUrl?: string) =>
      ipcRenderer.invoke(IpcChannel.settingsOllamaStatus, baseUrl),
    ollamaTest: (input: { baseUrl?: string; model: string }) =>
      ipcRenderer.invoke(IpcChannel.settingsOllamaTest, input),
    spotifyStatus: (clientId?: string) =>
      ipcRenderer.invoke(IpcChannel.settingsSpotifyStatus, clientId),
    spotifyConnect: (clientId?: string) =>
      ipcRenderer.invoke(IpcChannel.settingsSpotifyConnect, clientId),
    spotifyDisconnect: (clientId?: string) =>
      ipcRenderer.invoke(IpcChannel.settingsSpotifyDisconnect, clientId),
    spotifyListDevices: (clientId?: string) =>
      ipcRenderer.invoke(IpcChannel.settingsSpotifyListDevices, clientId),
    siteBlockStatus: (credentials?: { baseUrl?: string; token?: string }) =>
      ipcRenderer.invoke(IpcChannel.settingsSiteBlockStatus, credentials),
    roverStatus: (credentials?: { baseUrl?: string; token?: string }) =>
      ipcRenderer.invoke(IpcChannel.settingsRoverStatus, credentials),
    imagesStatus: (draft?: { forgeDir?: string; forgeUrl?: string; outputRoot?: string }) =>
      ipcRenderer.invoke(IpcChannel.settingsImagesStatus, draft),
    geocodeSearch: (query: string) => ipcRenderer.invoke(IpcChannel.settingsGeocodeSearch, query),
    googleStatus: (draft?: GoogleConfigDraft) => ipcRenderer.invoke(IpcChannel.settingsGoogleStatus, draft),
    googleConnect: (draft?: GoogleConfigDraft) => ipcRenderer.invoke(IpcChannel.settingsGoogleConnect, draft),
    googleCancel: () => ipcRenderer.invoke(IpcChannel.settingsGoogleCancel),
    googleDisconnect: () => ipcRenderer.invoke(IpcChannel.settingsGoogleDisconnect),
    personalizationGet: () => ipcRenderer.invoke(IpcChannel.settingsPersonalizationGet),
    personalizationReset: () => ipcRenderer.invoke(IpcChannel.settingsPersonalizationReset),
    knowledgeStats: () => ipcRenderer.invoke(IpcChannel.settingsKnowledgeStats),
    knowledgeClear: () => ipcRenderer.invoke(IpcChannel.settingsKnowledgeClear),
  },
  history: {
    list: () => ipcRenderer.invoke(IpcChannel.historyList),
    get: (id: string) => ipcRenderer.invoke(IpcChannel.historyGet, id),
    remove: (id: string) => ipcRenderer.invoke(IpcChannel.historyRemove, id),
    clear: () => ipcRenderer.invoke(IpcChannel.historyClear),
  },
  tools: {
    list: () => ipcRenderer.invoke(IpcChannel.toolsList),
  },
  audit: {
    list: (limit?: number) => ipcRenderer.invoke(IpcChannel.auditList, limit),
    clear: () => ipcRenderer.invoke(IpcChannel.auditClear),
  },
  window: {
    hide: () => ipcRenderer.invoke(IpcChannel.windowHide),
    resize: (height: number) => ipcRenderer.invoke(IpcChannel.windowResize, height),
    setChrome: (mode: WindowChrome) => ipcRenderer.invoke(IpcChannel.windowSetChrome, mode),
    isVisible: () => ipcRenderer.invoke(IpcChannel.windowIsVisible),
    onShown: (listener: () => void) => {
      const handler = (): void => listener();
      ipcRenderer.on(IpcChannel.windowShown, handler);
      return () => ipcRenderer.removeListener(IpcChannel.windowShown, handler);
    },
  },
  system: {
    snapshot: () => ipcRenderer.invoke(IpcChannel.systemSnapshot),
  },
  voice: {
    transcribe: (input: VoiceTranscribeInput) =>
      ipcRenderer.invoke(IpcChannel.voiceTranscribe, input),
    speak: (input: VoiceSpeakInput) => ipcRenderer.invoke(IpcChannel.voiceSpeak, input),
    piperSpeak: (input: VoicePiperSpeakInput) => ipcRenderer.invoke(IpcChannel.voicePiperSpeak, input),
    piperStatus: () => ipcRenderer.invoke(IpcChannel.voicePiperStatus),
    assetsReport: () => ipcRenderer.invoke(IpcChannel.voiceAssetsReport),
    copyReport: (text: string) => ipcRenderer.invoke(IpcChannel.voiceCopyReport, text),
    log: (line: string) => ipcRenderer.send(IpcChannel.voiceCaptureLog, line),
    openMicrophonePrivacy: () => ipcRenderer.invoke(IpcChannel.voiceOpenMicrophonePrivacy),
    setListening: (active: boolean) => ipcRenderer.send(IpcChannel.listeningIndicator, { active: active === true }),
    sendLevel: (level: number) => ipcRenderer.send(IpcChannel.listeningLevel, Number.isFinite(level) ? level : 0),
  },
  localLearning: {
    status: () => ipcRenderer.invoke(IpcChannel.localLearningStatus),
    onEvent: (listener: (status: LocalLearningRuntimeStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: LocalLearningRuntimeStatus): void =>
        listener(payload);
      ipcRenderer.on(IpcChannel.localLearningEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.localLearningEvent, handler);
    },
    snapshot: () => ipcRenderer.invoke(IpcChannel.localLearningSnapshot),
    train: () => ipcRenderer.invoke(IpcChannel.localLearningTrain),
    rollback: () => ipcRenderer.invoke(IpcChannel.localLearningRollback),
    setStatus: (id: string, status: LearningRecord['status']) =>
      ipcRenderer.invoke(IpcChannel.localLearningSetStatus, id, status),
    correct: (id: string, content: string) =>
      ipcRenderer.invoke(IpcChannel.localLearningCorrect, id, content),
    restore: (id: string) => ipcRenderer.invoke(IpcChannel.localLearningRestore, id),
    exportSkills: () => ipcRenderer.invoke(IpcChannel.localLearningExportSkills),
    remove: (id: string) => ipcRenderer.invoke(IpcChannel.localLearningRemove, id),
  },
  wakeLearning: {
    status: () => ipcRenderer.invoke(IpcChannel.wakeLearningStatus),
    addSample: (input: WakeLearningSampleInput) => ipcRenderer.invoke(IpcChannel.wakeLearningAddSample, input),
    recordStats: (kinds: WakeStatKind[]) => ipcRenderer.invoke(IpcChannel.wakeLearningStats, kinds),
    model: () => ipcRenderer.invoke(IpcChannel.wakeLearningModel),
    retrain: () => ipcRenderer.invoke(IpcChannel.wakeLearningRetrain),
    clear: () => ipcRenderer.invoke(IpcChannel.wakeLearningClear),
    reset: () => ipcRenderer.invoke(IpcChannel.wakeLearningReset),
  },
  youtube: {
    onTranscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: YoutubeTranscribeRequest): void =>
        listener(payload);
      ipcRenderer.on(IpcChannel.youtubeTranscribe, handler);
      return () => ipcRenderer.removeListener(IpcChannel.youtubeTranscribe, handler);
    },
    reportProgress: (payload: YoutubeTranscribeProgress) =>
      ipcRenderer.send(IpcChannel.youtubeTranscribeProgress, payload),
    reportResult: (payload: YoutubeTranscribeResult) =>
      ipcRenderer.send(IpcChannel.youtubeTranscribeResult, payload),
  },
  update: {
    getState: () => ipcRenderer.invoke(IpcChannel.updateGetState),
    check: () => ipcRenderer.invoke(IpcChannel.updateCheck),
    install: () => ipcRenderer.invoke(IpcChannel.updateInstall),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: UpdateState): void =>
        listener(payload);
      ipcRenderer.on(IpcChannel.updateEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.updateEvent, handler);
    },
  },
  phone: {
    status: () => ipcRenderer.invoke(IpcChannel.phoneStatus),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke(IpcChannel.phoneSetEnabled, enabled),
    startPairing: () => ipcRenderer.invoke(IpcChannel.phoneStartPairing),
    cancelPairing: () => ipcRenderer.invoke(IpcChannel.phoneCancelPairing),
    revoke: (deviceId: string) => ipcRenderer.invoke(IpcChannel.phoneRevoke, deviceId),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: PhoneStatus): void => listener(payload);
      ipcRenderer.on(IpcChannel.phoneEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.phoneEvent, handler);
    },
  },
  speaker: {
    status: () => ipcRenderer.invoke(IpcChannel.speakerStatus),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke(IpcChannel.speakerSetEnabled, enabled),
    add: (name: string) => ipcRenderer.invoke(IpcChannel.speakerAdd, name),
    remove: (speakerId: string) => ipcRenderer.invoke(IpcChannel.speakerRemove, speakerId),
    beginInstall: (name: string, mac: string) => ipcRenderer.invoke(IpcChannel.speakerBeginInstall, { name, mac }),
    commitInstall: (id: string, fw?: string) => ipcRenderer.invoke(IpcChannel.speakerCommitInstall, { id, fw }),
    abandonInstall: (id: string) => ipcRenderer.invoke(IpcChannel.speakerAbandonInstall, id),
    pickPort: (portId: string) => ipcRenderer.invoke(IpcChannel.speakerPickPort, portId),
    firmware: () => ipcRenderer.invoke(IpcChannel.speakerFirmware),
    onPorts: (listener: (ports: Array<{ portId: string; label: string }>) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, ports: Array<{ portId: string; label: string }>): void => listener(ports);
      ipcRenderer.on(IpcChannel.speakerPorts, handler);
      return () => ipcRenderer.removeListener(IpcChannel.speakerPorts, handler);
    },
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SpeakerStatus): void => listener(payload);
      ipcRenderer.on(IpcChannel.speakerEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.speakerEvent, handler);
    },
    onTranscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SpeakerTranscribeRequest): void => listener(payload);
      ipcRenderer.on(IpcChannel.speakerTranscribeRequest, handler);
      return () => ipcRenderer.removeListener(IpcChannel.speakerTranscribeRequest, handler);
    },
    reportTranscript: (payload: SpeakerTranscribeResult) => ipcRenderer.send(IpcChannel.speakerTranscribeResult, payload),
    onShow: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SpeakerShowConversation): void => listener(payload);
      ipcRenderer.on(IpcChannel.speakerShowConversation, handler);
      return () => ipcRenderer.removeListener(IpcChannel.speakerShowConversation, handler);
    },
    chrono: () => ipcRenderer.invoke(IpcChannel.speakerChrono),
    resetChrono: () => ipcRenderer.invoke(IpcChannel.speakerChronoReset),
    onHoldWhisper: (listener) => {
      const handler = (): void => listener();
      ipcRenderer.on(IpcChannel.speakerHoldWhisper, handler);
      return () => ipcRenderer.removeListener(IpcChannel.speakerHoldWhisper, handler);
    },
    netStatus: () => ipcRenderer.invoke(IpcChannel.speakerNetStatus),
    repair: () => ipcRenderer.invoke(IpcChannel.speakerRepair),
    makePrivate: (index: number) => ipcRenderer.invoke(IpcChannel.speakerMakePrivate, index),
    signal: (id: string) => ipcRenderer.invoke(IpcChannel.speakerSignal, id),
    rename: (id: string, name: string) => ipcRenderer.invoke(IpcChannel.speakerRename, { id, name }),
  },
  developer: createDeveloperApi(ipcRenderer),
  health: {
    current: () => ipcRenderer.invoke(IpcChannel.healthCurrent),
    refresh: () => ipcRenderer.invoke(IpcChannel.healthRefresh),
    onReport: (listener: (report: HealthReport) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: HealthReport): void => listener(payload);
      ipcRenderer.on(IpcChannel.healthEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.healthEvent, handler);
    },
  },
  backup: {
    state: () => ipcRenderer.invoke(IpcChannel.backupState),
    now: () => ipcRenderer.invoke(IpcChannel.backupNow),
    list: () => ipcRenderer.invoke(IpcChannel.backupList),
    pickDirectory: () => ipcRenderer.invoke(IpcChannel.backupPick),
    restore: (name: string) => ipcRenderer.invoke(IpcChannel.backupRestore, name),
  },
  know: {
    summary: () => ipcRenderer.invoke(IpcChannel.knowSummary),
    view: (id: string) => ipcRenderer.invoke(IpcChannel.knowView, id),
    exportAll: () => ipcRenderer.invoke(IpcChannel.knowExport),
    erase: (id: string, conversationId?: string) => ipcRenderer.invoke(IpcChannel.knowErase, id, conversationId),
    eraseAll: () => ipcRenderer.invoke(IpcChannel.knowEraseAll),
  },
  questionnaire: {
    get: () => ipcRenderer.invoke(IpcChannel.questionnaireGet),
    set: (patch) => ipcRenderer.invoke(IpcChannel.questionnaireSet, patch),
    apply: () => ipcRenderer.invoke(IpcChannel.questionnaireApply),
    restore: () => ipcRenderer.invoke(IpcChannel.questionnaireRestore),
  },
  edition: {
    state: () => ipcRenderer.invoke(IpcChannel.editionState),
    claim: async (name: ReservedName) => {
      const result = (await ipcRenderer.invoke(IpcChannel.editionClaim, name)) as EditionClaimResult;
      for (const listener of claimListeners) listener(result);
      return result;
    },
    onClaimed: (listener: (result: EditionClaimResult) => void) => {
      claimListeners.add(listener);
      return () => claimListeners.delete(listener);
    },
  },
  machine: {
    status: () => ipcRenderer.invoke(IpcChannel.machineStatus),
    analyze: () => ipcRenderer.invoke(IpcChannel.machineAnalyze),
    pull: () => ipcRenderer.invoke(IpcChannel.machinePull),
    cancelPull: () => ipcRenderer.invoke(IpcChannel.machinePullCancel),
    apply: () => ipcRenderer.invoke(IpcChannel.machineApply),
    onPull: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: MachinePullProgress): void =>
        listener(payload);
      ipcRenderer.on(IpcChannel.machinePullEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.machinePullEvent, handler);
    },
  },
};

contextBridge.exposeInMainWorld('jarvis', api);
contextBridge.exposeInMainWorld('jarvisNativeCaption', process.platform === 'win32');
