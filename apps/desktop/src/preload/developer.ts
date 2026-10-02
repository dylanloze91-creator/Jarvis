import type { IpcRenderer, IpcRendererEvent } from 'electron';
import {
  DeveloperChannel,
  type DeveloperApi,
  type DeveloperState,
} from '../shared/developerIpc.js';

/** Surface `window.jarvis.developer` : appels typés seulement, pas d'ipcRenderer brut. */
export function createDeveloperApi(ipc: IpcRenderer): DeveloperApi {
  return {
    status: () => ipc.invoke(DeveloperChannel.status),
    detect: () => ipc.invoke(DeveloperChannel.detect),
    validate: (path: string) => ipc.invoke(DeveloperChannel.validate, path),
    checkEnvironment: () => ipc.invoke(DeveloperChannel.environment),
    clone: (path: string) => ipc.invoke(DeveloperChannel.clone, path),
    install: () => ipc.invoke(DeveloperChannel.install),
    analyze: () => ipc.invoke(DeveloperChannel.analyze),
    cancel: () => ipc.invoke(DeveloperChannel.cancel),
    respondConfirmation: (requestId: string, approved: boolean) =>
      ipc.invoke(DeveloperChannel.confirmRespond, requestId, approved),
    onEvent: (listener) => {
      const handler = (_event: IpcRendererEvent, state: DeveloperState): void => listener(state);
      ipc.on(DeveloperChannel.event, handler);
      return () => ipc.removeListener(DeveloperChannel.event, handler);
    },
  };
}
