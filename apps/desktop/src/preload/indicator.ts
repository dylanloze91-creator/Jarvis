import { contextBridge, ipcRenderer } from 'electron';

/** Surface de l'indicateur d'écoute : recevoir le niveau du micro, rien d'autre. */
contextBridge.exposeInMainWorld('jarvisIndicator', {
  onLevel: (listener: (level: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, level: unknown): void => {
      if (typeof level === 'number' && Number.isFinite(level)) listener(level);
    };
    ipcRenderer.on('indicator:level', handler);
    return () => ipcRenderer.removeListener('indicator:level', handler);
  },
});
