import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diagnosticLines } from './diag.js';

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
  });
});
