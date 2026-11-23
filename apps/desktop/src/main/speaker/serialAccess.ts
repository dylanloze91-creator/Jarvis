/**
 * Accès série limité à la fenêtre de Jarvis. Pas de module natif : Web Serial d'Electron.
 */
import { autoEspressif, rankSerialPorts, type RankedPort, type SerialCandidate } from '@jarvis/core';

export type PermissionCheckHandler = (
  webContents: unknown,
  permission: string,
  requestingOrigin: string,
  details?: { mediaType?: string },
) => boolean;

export interface SerialSessionLike {
  on(event: 'select-serial-port', listener: (event: { preventDefault(): void }, ports: SerialCandidate[], webContents: unknown, callback: (portId: string) => void) => void): void;
  /** Signature d'Electron : (webContents, permission, requestingOrigin, details). `mediaType` est dans `details`. */
  setPermissionCheckHandler(handler: PermissionCheckHandler): void;
  setDevicePermissionHandler(handler: (details: { deviceType: string; origin?: string }) => boolean): void;
}

/**
 * Un seul gestionnaire. Le micro garde `allowOther` (souvent `allowPermissionCheck`).
 * Le port série n'est accordé qu'à la fenêtre de Jarvis.
 */
export function combinePermissionCheck(
  permission: string,
  mediaType: string | undefined,
  isJarvisWindow: boolean,
  allowOther: (permission: string, mediaType?: string) => boolean,
): boolean {
  if (permission === 'serial') return isJarvisWindow;
  return allowOther(permission, mediaType);
}

/** Appareil série seulement, et seulement si l'origine est celle de Jarvis. */
export function allowSerialDevice(deviceType: string, origin: string | undefined, isJarvisOrigin: (origin: string) => boolean): boolean {
  return deviceType === 'serial' && isJarvisOrigin(origin ?? '');
}

export function bindSerialAccess(
  session: SerialSessionLike,
  isJarvisWindow: (webContents: unknown) => boolean,
  allowOther: (permission: string, mediaType?: string) => boolean,
  isJarvisOrigin: (origin: string) => boolean,
  onList?: (ports: RankedPort[]) => void,
): { pick(portId: string): void } {
  // Le troisième argument est l'origine, jamais le type de média : il n'est pas lu.
  session.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) =>
    combinePermissionCheck(permission, details?.mediaType, isJarvisWindow(webContents), allowOther),
  );
  session.setDevicePermissionHandler((details) => allowSerialDevice(details.deviceType, details.origin, isJarvisOrigin));
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
    onList?.(ranked);
    // La fenêtre n'affiche pas de liste de ports : attendre un choix bloquait
    // l'installation pour toujours (23 novembre). Sans une seule carte Espressif,
    // la demande est refusée tout de suite et l'écran le dit.
    callback('');
  });
  return {
    /** Gardé pour le canal IPC : plus aucune demande n'attend un choix. */
    pick(_portId: string) {},
  };
}
