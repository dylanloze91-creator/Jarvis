/**
 * Accès série limité à la fenêtre de Jarvis. Pas de module natif : Web Serial d'Electron.
 */
import { autoEspressif, rankSerialPorts, type RankedPort, type SerialCandidate } from '@jarvis/core';

export interface SerialSessionLike {
  on(event: 'select-serial-port', listener: (event: { preventDefault(): void }, ports: SerialCandidate[], webContents: unknown, callback: (portId: string) => void) => void): void;
  setPermissionCheckHandler(handler: (webContents: unknown, permission: string) => boolean): void;
  setDevicePermissionHandler(handler: (details: { deviceType: string }) => boolean): void;
}

export function bindSerialAccess(
  session: SerialSessionLike,
  isJarvisWindow: (webContents: unknown) => boolean,
  onList?: (ports: RankedPort[]) => void,
): { pick(portId: string): void } {
  let waiting: ((portId: string) => void) | null = null;
  session.setPermissionCheckHandler((webContents, permission) => permission === 'serial' && isJarvisWindow(webContents));
  session.setDevicePermissionHandler((details) => details.deviceType === 'serial');
  session.on('select-serial-port', (event, ports, webContents, callback) => {
    event.preventDefault();
    if (!isJarvisWindow(webContents)) {
      callback('');
      return;
    }
    const ranked = rankSerialPorts(ports);
    const only = autoEspressif(ranked);
    if (only) {
      callback(only.portId);
      return;
    }
    waiting = callback;
    onList?.(ranked);
  });
  return {
    pick(portId: string) {
      const callback = waiting;
      waiting = null;
      callback?.(portId);
    },
  };
}
