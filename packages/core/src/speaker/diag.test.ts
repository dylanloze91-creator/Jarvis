import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diagnosticLines, homeInterface, opensDiagnostic, parseNetStatus, privateIndex } from './diag.js';
import { firewallPort } from './interfaces.js';

const frozen = {
  bridgeRunning: true,
  firewallTcp: false,
  firewallMdns: false,
  networkPrivate: false,
  kept: ['192.168.1.20'],
  dropped: [{ address: '100.64.0.8', reason: 'Tailscale' }],
  speakers: [{ name: 'Salon', lastHelloAt: 1_000 }, { name: 'Chambre', lastHelloAt: null }],
  now: 61_000,
};

describe('diagnostic', () => {
  it('lit un exemple figé', () => {
    const lines = diagnosticLines(frozen);
    expect(lines.find((line) => line.id === 'private')?.sentence).toContain('Public');
    expect(lines.find((line) => line.id === 'addresses')?.sentence).toContain('Tailscale');
    expect(lines.find((line) => line.id === 'life')?.sentence).toContain('Chambre : jamais');
    expect(lines.find((line) => line.id === 'firewall-tcp')?.ok).toBe(false);
  });

  it('le script de pare-feu est constant et ne contient que le port en paramètre', () => {
    const script = readFileSync(new URL('../../../../apps/desktop/resources/speaker-firewall.ps1', import.meta.url), 'utf8');
    expect(script).toContain('[int]$Port');
    expect(script).not.toMatch(/\$\{/);
    expect(script).toContain('Jarvis — enceintes (TCP 53131)');
    expect(script).toContain('-Profile Private');
    const mdns = script.split('\n').find((line) => line.includes("mDNS"));
    expect(mdns).toContain('5353');
    expect(mdns).not.toContain('$Port');
  });

  it('lit le JSON figé du réseau et ne vise que la maison', () => {
    const text = JSON.stringify({
      tcp53131: true,
      udp5353: false,
      profiles: [
        { index: 12, name: 'Wi-Fi', category: 'Public', addresses: ['192.168.1.20'] },
        { index: 18, name: 'Tailscale', category: 'Public', addresses: ['100.64.0.8'] },
      ],
    });
    const status = parseNetStatus(text);
    expect(status?.tcp53131).toBe(true);
    expect(status?.udp5353).toBe(false);
    const home = homeInterface(status?.profiles ?? [], ['192.168.1.20']);
    expect(home?.index).toBe(12);
    expect(privateIndex(12, home)).toBe(12);
    expect(privateIndex(18, home)).toBeNull();
    expect(privateIndex('12', home)).toBeNull();
    expect(privateIndex(12.5, home)).toBeNull();
    expect(firewallPort(53131)).toBe(53131);
    expect(firewallPort('53131')).toBe(53131);
    expect(firewallPort('abc')).toBeNull();
    expect(parseNetStatus('{')).toBeNull();
    expect(opensDiagnostic('pc')).toBe(true);
    expect(opensDiagnostic('bridge')).toBe(true);
    expect(opensDiagnostic('wifi')).toBe(false);
  });

  it('le script privé ne prend qu’un index, et la lecture n’a aucun argument', () => {
    const root = new URL('../../../../apps/desktop/resources/', import.meta.url);
    const priv = readFileSync(new URL('speaker-private.ps1', root), 'utf8');
    expect(priv).toContain('[int]$InterfaceIndex');
    expect(priv).toContain('Set-NetConnectionProfile -InterfaceIndex $InterfaceIndex');
    expect(priv).not.toContain('Get-NetConnectionProfile');
    const status = readFileSync(new URL('speaker-net-status.ps1', root), 'utf8');
    expect(status).not.toContain('Mandatory');
    expect(status).toContain("Port '5353'");
    expect(status).toContain("Port '53131'");
    expect(status).not.toContain('Set-Net');
    expect(status).not.toContain('New-Net');
  });
});
