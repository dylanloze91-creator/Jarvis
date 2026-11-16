import { describe, expect, it } from 'vitest';
import { allowPermissionCheck } from '../mediaPermissions.js';
import { bindSerialAccess, type PermissionCheckHandler, type SerialSessionLike } from './serialAccess.js';

describe('accès série', () => {
  it('garde la règle du micro et n’accorde le port série qu’à Jarvis', () => {
    // Le faux de session suit la vraie signature d'Electron :
    // (webContents, permission, requestingOrigin, details), `mediaType` dans `details`.
    type Check = PermissionCheckHandler;
    type Select = (event: { preventDefault(): void }, ports: Array<{ portId: string; usbVendorId?: number; portName?: string }>, webContents: unknown, callback: (portId: string) => void) => void;
    const seen: {
      check: Check | null;
      device: ((details: { deviceType: string; origin?: string }) => boolean) | null;
      select: Select | null;
    } = { check: null, device: null, select: null };
    const session: SerialSessionLike = {
      on: (_event, listener) => {
        seen.select = listener;
      },
      setPermissionCheckHandler: (handler) => {
        seen.check = handler;
      },
      setDevicePermissionHandler: (handler) => {
        seen.device = handler;
      },
    };
    const ours = {};
    const other = {};
    bindSerialAccess(
      session,
      (webContents) => webContents === ours,
      (permission, mediaType) => allowPermissionCheck(permission, mediaType),
      (origin) => origin === 'file://' || origin.startsWith('file:'),
    );
    const check = seen.check;
    expect(check).toBeTruthy();
    const origin = 'file://';
    expect(check?.(ours, 'media', origin, { mediaType: 'audio' })).toBe(true);
    // La caméra reste refusée : avant la retouche, l'origine était lue à la place de `mediaType`.
    expect(check?.(ours, 'media', origin, { mediaType: 'video' })).toBe(false);
    expect(check?.(ours, 'media', 'video', { mediaType: 'audio' })).toBe(true);
    expect(check?.(ours, 'media', origin, { mediaType: 'unknown' })).toBe(allowPermissionCheck('media', 'unknown'));
    expect(check?.(ours, 'media', origin, {})).toBe(allowPermissionCheck('media'));
    expect(check?.(ours, 'media', origin)).toBe(allowPermissionCheck('media'));
    expect(check?.(ours, 'clipboard-sanitized-write', origin, {})).toBe(true);
    expect(check?.(ours, 'serial', origin, {})).toBe(true);
    expect(check?.(other, 'serial', origin, {})).toBe(false);
    expect(check?.(other, 'media', origin, { mediaType: 'audio' })).toBe(true);
    expect(check?.(other, 'media', origin, { mediaType: 'video' })).toBe(false);
    expect(seen.device?.({ deviceType: 'serial', origin: 'file:///Jarvis/index.html' })).toBe(true);
    expect(seen.device?.({ deviceType: 'serial', origin: 'https://exemple.test' })).toBe(false);
    expect(seen.device?.({ deviceType: 'usb', origin: 'file:///Jarvis/index.html' })).toBe(false);
    const chosen: string[] = [];
    seen.select?.({ preventDefault() {} }, [{ portId: 'com5', usbVendorId: 0x303a, portName: 'COM5' }], ours, (portId) => chosen.push(portId));
    expect(chosen).toEqual(['com5']);
    seen.select?.({ preventDefault() {} }, [{ portId: 'com5', usbVendorId: 0x303a, portName: 'COM5' }], other, (portId) => chosen.push(portId));
    expect(chosen).toEqual(['com5', '']);
  });
});
