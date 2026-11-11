import { describe, expect, it } from 'vitest';
import { interfacesFromTables } from './lan.js';

describe('interfaces de la maison', () => {
  it('rattache la passerelle lue dans la table de routes', () => {
    const ifaces = interfacesFromTables(
      [
        { name: 'wlan0', address: '192.168.1.20' },
        { name: 'tailscale0', address: '100.64.0.8' },
      ],
      { wlan0: '192.168.1.1' },
      {},
    );
    expect(ifaces[0]).toEqual({ name: 'wlan0', address: '192.168.1.20', gateway: '192.168.1.1' });
    expect(ifaces[1]?.gateway).toBeNull();
  });
});
