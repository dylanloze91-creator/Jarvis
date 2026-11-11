import { describe, expect, it } from 'vitest';
import { bindSerialAccess, type SerialSessionLike } from './serialAccess.js';

describe('accès série', () => {
  it('choisit seul une carte Espressif et refuse une autre fenêtre', () => {
    type Select = (event: { preventDefault(): void }, ports: Array<{ portId: string; usbVendorId?: number; portName?: string }>, webContents: unknown, callback: (portId: string) => void) => void;
    const seen: { check: ((webContents: unknown, permission: string) => boolean) | null; select: Select | null } = {
      check: null,
      select: null,
    };
    const session: SerialSessionLike = {
      on: (_event, listener) => {
        seen.select = listener;
      },
      setPermissionCheckHandler: (handler) => {
        seen.check = handler;
      },
      setDevicePermissionHandler: () => undefined,
    };
    const ours = {};
    const other = {};
    bindSerialAccess(session, (webContents) => webContents === ours);
    expect(seen.check?.(ours, 'serial')).toBe(true);
    expect(seen.check?.(ours, 'media')).toBe(false);
    expect(seen.check?.(other, 'serial')).toBe(false);
    const chosen: string[] = [];
    seen.select?.({ preventDefault() {} }, [{ portId: 'com5', usbVendorId: 0x303a, portName: 'COM5' }], ours, (portId) => chosen.push(portId));
    expect(chosen).toEqual(['com5']);
    seen.select?.({ preventDefault() {} }, [{ portId: 'com5', usbVendorId: 0x303a, portName: 'COM5' }], other, (portId) => chosen.push(portId));
    expect(chosen).toEqual(['com5', '']);
  });
});
