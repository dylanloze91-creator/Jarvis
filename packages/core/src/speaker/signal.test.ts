import { describe, expect, it } from 'vitest';
import { readHelloHeaders, rssiToBars, speakerFreshness } from './signal.js';

describe('signal et signe de vie', () => {
  it('transforme le RSSI en barres', () => {
    expect(rssiToBars(-40)).toBe(4);
    expect(rssiToBars(-60)).toBe(3);
    expect(rssiToBars(-70)).toBe(2);
    expect(rssiToBars(-80)).toBe(1);
    expect(rssiToBars(-90)).toBe(0);
  });

  it('lit les en-têtes et reconnaît une ancienne enceinte', () => {
    expect(readHelloHeaders({ 'x-jarvis-fw': '5.0.75', 'x-jarvis-rssi': '-52', 'x-jarvis-ip': '192.168.1.30', 'x-jarvis-mac': 'AA:BB:CC:DD:EE:FF' })).toEqual({
      fw: '5.0.75',
      rssi: -52,
      ip: '192.168.1.30',
      mac: 'aa:bb:cc:dd:ee:ff',
    });
    expect(readHelloHeaders({})).toEqual({});
    expect(speakerFreshness(undefined, '5.0.75')).toBe('old');
    expect(speakerFreshness('5.0.75', '5.0.75')).toBe('current');
    expect(speakerFreshness('5.0.64', '5.0.75')).toBe('update');
  });
});
