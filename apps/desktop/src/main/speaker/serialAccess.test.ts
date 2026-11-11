import { describe, expect, it } from 'vitest';
import { allowPermissionCheck } from '../mediaPermissions.js';
import { bindSerialAccess, type SerialSessionLike } from './serialAccess.js';

describe('accès série', () => {
  it('garde la règle du micro et n’accorde le port série qu’à Jarvis', () => {
    type Check = (webContents: unknown, permission: string, mediaType?: string) => boolean;
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
    expect(check?.(ours, 'media', 'audio')).toBe(allowPermissionCheck('media', 'audio'));
    expect(check?.(ours, 'media', 'video')).toBe(allowPermissionCheck('media', 'video'));
    expect(check?.(ours, 'media')).toBe(allowPermissionCheck('media'));
    expect(check?.(ours, 'clipboard-sanitized-write')).toBe(true);
    expect(check?.(ours, 'serial')).toBe(true);
    expect(check?.(other, 'serial')).toBe(false);
    expect(check?.(other, 'media', 'audio')).toBe(true);
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
