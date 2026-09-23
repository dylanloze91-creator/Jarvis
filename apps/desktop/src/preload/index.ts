import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type ChatEvent, type JarvisApi, type SendChatInput } from '../shared/ipc.js';
import type { Settings } from '@jarvis/core';

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
  window: {
    hide: () => ipcRenderer.invoke(IpcChannel.windowHide),
    resize: (height: number) => ipcRenderer.invoke(IpcChannel.windowResize, height),
  },
};

contextBridge.exposeInMainWorld('jarvis', api);
