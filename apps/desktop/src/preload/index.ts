import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type ChatEvent,
  type GoogleConfigDraft,
  type JarvisApi,
  type SendChatInput,
  type UpdateState,
  type VoiceSpeakInput,
  type VoiceTranscribeInput,
  type WakeLearningSampleInput,
  type WindowChrome,
  type YoutubeTranscribeProgress,
  type YoutubeTranscribeRequest,
  type YoutubeTranscribeResult,
} from '../shared/ipc.js';
import type { Settings, WakeStatKind } from '@jarvis/core';

/**
 * Seule surface exposée au renderer. Elle est volontairement étroite : pas
 * d'accès à `ipcRenderer` brut, pas de Node, uniquement ces appels typés.
 */
const api: JarvisApi = {
  chat: {
    send: (input: SendChatInput) => ipcRenderer.invoke(IpcChannel.chatSend, input),
    cancel: () => ipcRenderer.invoke(IpcChannel.chatCancel),
    respondConfirmation: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke(IpcChannel.confirmRespond, requestId, approved),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: ChatEvent): void =>
        listener(payload);
      ipcRenderer.on(IpcChannel.chatEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.chatEvent, handler);
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
    siteBlockStatus: (credentials?: { baseUrl?: string; token?: string }) =>
      ipcRenderer.invoke(IpcChannel.settingsSiteBlockStatus, credentials),
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
    assetsReport: () => ipcRenderer.invoke(IpcChannel.voiceAssetsReport),
    copyReport: (text: string) => ipcRenderer.invoke(IpcChannel.voiceCopyReport, text),
    log: (line: string) => ipcRenderer.send(IpcChannel.voiceCaptureLog, line),
    openMicrophonePrivacy: () => ipcRenderer.invoke(IpcChannel.voiceOpenMicrophonePrivacy),
    setListening: (active: boolean) => ipcRenderer.send(IpcChannel.listeningIndicator, { active: active === true }),
    sendLevel: (level: number) => ipcRenderer.send(IpcChannel.listeningLevel, Number.isFinite(level) ? level : 0),
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
};

contextBridge.exposeInMainWorld('jarvis', api);
