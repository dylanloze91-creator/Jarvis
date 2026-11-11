import { describe, expect, it } from 'vitest';
import { announceInterfaces, firewallPort, gatewaysFromProcRoute, gatewaysFromWindowsRoute, mdnsAnswers } from './interfaces.js';

describe('adresses annoncées', () => {
  it('garde la carte de la maison et écarte Tailscale, Radmin et les virtuelles', () => {
    const decision = announceInterfaces([
      { name: 'Wi-Fi', address: '192.168.1.20', gateway: '192.168.1.1' },
      { name: 'Ethernet', address: '10.0.0.4', gateway: '10.0.0.1' },
      { name: 'Tailscale', address: '100.64.0.5', gateway: '100.64.0.1' },
      { name: 'Radmin', address: '26.0.0.8', gateway: '26.0.0.1' },
      { name: 'vEthernet (WSL)', address: '172.22.0.1', gateway: '172.22.0.1' },
      { name: 'VMware Network', address: '192.168.152.1', gateway: '192.168.152.2' },
      { name: 'Bluetooth', address: '169.254.1.1', gateway: null },
      { name: 'Sans box', address: '192.168.0.9', gateway: null },
    ]);
    expect(decision.kept).toEqual(['192.168.1.20', '10.0.0.4']);
    expect(decision.dropped.map((item) => item.reason)).toEqual([
      'Tailscale',
      'Radmin',
      'vethernet',
      'vmware',
      'pas une adresse de la maison',
      'pas de passerelle',
    ]);
  });
});

describe('réponses mDNS', () => {
  it('répond PTR, SRV, TXT et A, et rien pour un autre service', () => {
    const ctx = { pcId: 'ab12cd34', port: 53131, addresses: ['192.168.1.20'], hostname: 'pc-synthetique' };
    const answers = mdnsAnswers([{ name: '_jarvis-speaker._tcp.local', type: 'PTR' }], ctx);
    expect(answers.map((item) => item.type)).toEqual(['PTR', 'SRV', 'TXT', 'A']);
    expect(answers.find((item) => item.type === 'TXT')?.data).toEqual(['pc=ab12cd34', 'v=1']);
    expect(mdnsAnswers([{ name: '_http._tcp.local', type: 'PTR' }], ctx)).toEqual([]);
  });
});

describe('passerelles', () => {
  it('lit la route par défaut Linux et Windows', () => {
    const linux = ['Iface Destination Gateway Flags', 'wlan0 00000000 0101A8C0 0003', 'eth0 00010203 0201A8C0 0003'].join('\n');
    expect(gatewaysFromProcRoute(linux)).toEqual({ wlan0: '192.168.1.1' });
    const windows = '0.0.0.0  0.0.0.0  192.168.1.1  192.168.1.20  25';
    expect(gatewaysFromWindowsRoute(windows)).toEqual({ '192.168.1.20': '192.168.1.1' });
  });
});

describe('port du pare-feu', () => {
  it('n’accepte qu’un nombre', () => {
    expect(firewallPort(53131)).toBe(53131);
    expect(firewallPort('53131')).toBe(53131);
    expect(firewallPort('53131; Remove-Item')).toBeNull();
    expect(firewallPort(0)).toBeNull();
    expect(firewallPort('')).toBeNull();
  });
});
