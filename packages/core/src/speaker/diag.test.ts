import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diagnosticLines, firewallOpens, homeInterface, opensDiagnostic, parseNetStatus, privateIndex } from './diag.js';
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

  it('reconnaît n’importe quelle règle active qui ouvre TCP 53131 et UDP 5353 sur le profil Privé', () => {
    const profiles = [{ index: 12, name: 'Wi-Fi', category: 'Private', addresses: ['192.168.1.20'] }];
    const read = (rules: unknown) => parseNetStatus(JSON.stringify({ tcp53131: false, udp5353: false, rules, profiles }));
    // Règle faite à la main (le cas de l'utilisateur) : un autre nom, tous les programmes.
    const manual = read([
      { profile: 'Private', protocol: 'TCP', ports: ['53131'], program: 'Any' },
      { profile: 'Private, Public', protocol: 'UDP', ports: ['5353'], program: 'Any' },
    ]);
    expect(manual?.tcp53131).toBe(true);
    expect(manual?.udp5353).toBe(true);
    // Règles créées par Windows pour Jarvis.exe (« Autoriser l'accès ») : tous les ports, ce programme.
    const byProgram = read([
      { profile: 'Private', protocol: 'TCP', ports: ['Any'], program: 'C:\\Users\\Zoé\\AppData\\Local\\Programs\\Jarvis\\Jarvis.exe' },
      { profile: 'Private', protocol: 'UDP', ports: ['Any'], program: 'C:\\Users\\Zoé\\AppData\\Local\\Programs\\Jarvis\\jarvis.EXE' },
    ]);
    expect(byProgram?.tcp53131).toBe(true);
    expect(byProgram?.udp5353).toBe(true);
    // Profil en nombre (Privé = 2, tous = 0), protocole en numéro, plage de ports, port seul (objet ou chaîne).
    expect(read([{ profile: 3, protocol: '6', ports: ['50000-60000'], program: 'Any' }])?.tcp53131).toBe(true);
    expect(read({ profile: 0, protocol: 17, ports: '5353', program: 'Any' })?.udp5353).toBe(true);
    expect(read([{ profile: 'Any', protocol: 'Any', ports: ['Any'], program: 'Any' }])).toMatchObject({ tcp53131: true, udp5353: true });
    // Ce qui ne compte pas : profil Public seul, autre programme (le mDNS de Windows), autre port, autre protocole.
    const closed = read([
      { profile: 'Public', protocol: 'TCP', ports: ['53131'], program: 'Any' },
      { profile: 'Domain, Public', protocol: 'UDP', ports: ['5353'], program: 'Any' },
      { profile: 4, protocol: 'TCP', ports: ['53131'], program: 'Any' },
      { profile: 'Private', protocol: 'UDP', ports: ['5353'], program: '%SystemRoot%\\system32\\svchost.exe' },
      { profile: 'Private', protocol: 'TCP', ports: ['Any'], program: 'C:\\Program Files\\Autre\\NotJarvis.exe' },
      { profile: 'Private', protocol: 'TCP', ports: ['53130', '53132-53140', 'RPC'], program: 'Any' },
      { profile: 'Private', protocol: 'UDP', ports: ['53131'], program: 'Any' },
      { profile: 'Private', protocol: 'TCP', ports: ['5353'], program: 'Any' },
      { profile: 'Private', protocol: 'ICMPv4', ports: ['Any'], program: 'Any' },
      'illisible',
      { profile: 'Private', protocol: 'TCP' },
    ]);
    expect(closed).toMatchObject({ tcp53131: false, udp5353: false });
    expect(closed?.profiles).toHaveLength(1);
    // Les règles posées par « Réparer » (nommées) comptent toujours, et un script d'avant (sans `rules`) reste lu.
    expect(parseNetStatus(JSON.stringify({ tcp53131: true, udp5353: false, profiles }))).toMatchObject({ tcp53131: true, udp5353: false });
    expect(firewallOpens([], 'TCP', 53131)).toBe(false);
  });

  it('le script de lecture rapporte toutes les règles entrantes actives, sans rien changer', () => {
    const root = new URL('../../../../apps/desktop/resources/', import.meta.url);
    const status = readFileSync(new URL('speaker-net-status.ps1', root), 'utf8');
    expect(status).toContain('Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow');
    expect(status).toContain('Get-NetFirewallPortFilter -All');
    expect(status).toContain('Get-NetFirewallApplicationFilter -All');
    expect(status).toContain('rules = @($rules)');
    expect(status).not.toMatch(/\b(Set|New|Remove|Enable|Disable)-Net/);
    expect(status).not.toMatch(/^param\(/m);
    // 5.0.77 : sur un PC où NetSecurity est refusé sans élévation (« Accès refusé », PC de l'utilisateur,
    // 12 novembre 2026), le script relit les mêmes règles par l'API COM du pare-feu, toujours en lecture seule.
    expect(status).toContain('New-Object -ComObject HNetCfg.FwPolicy2');
    expect(status).toContain('Read-RulesByCom');
    expect(status).toContain('-ErrorAction Stop');
    expect(status).not.toMatch(/\.(Add|Remove)\(/);
    // Une règle limitée à une appli du Store, un service, une adresse, une interface ou un type
    // d'interface n'ouvre pas le port de Jarvis : elle n'est pas rapportée (vu le 12 novembre 2026 :
    // 26 règles « tout » du Store ou de Tailscale faisaient dire « ouvert » un port fermé).
    for (const filter of [
      'Get-NetFirewallAddressFilter -All',
      'Get-NetFirewallServiceFilter -All',
      'Get-NetFirewallInterfaceFilter -All',
      'Get-NetFirewallInterfaceTypeFilter -All',
    ]) {
      expect(status).toContain(filter);
    }
    expect(status).toContain('$af.Package');
    expect(status).toContain('LocalAppPackageId');
    expect(status).toContain('$rule.ServiceName');
    expect(status).toContain('$rule.LocalAddresses');
    expect(status).toContain('$rule.Interfaces');
    expect(status).toContain('$rule.InterfaceTypes');
  });

  it('les scripts PowerShell portent la marque UTF-8 (sinon Windows PowerShell 5.1 abîme « — » dans le nom des règles)', () => {
    const root = new URL('../../../../apps/desktop/resources/', import.meta.url);
    for (const name of ['speaker-firewall.ps1', 'speaker-net-status.ps1', 'speaker-private.ps1']) {
      const bytes = readFileSync(new URL(name, root));
      expect([bytes[0], bytes[1], bytes[2]], name).toEqual([0xef, 0xbb, 0xbf]);
      // Une seule marque, et le script commence toujours par son commentaire.
      expect(bytes.subarray(3, 11).toString('utf8'), name).toBe('# Jarvis');
    }
    const firewall = readFileSync(new URL('speaker-firewall.ps1', root), 'utf8');
    const status = readFileSync(new URL('speaker-net-status.ps1', root), 'utf8');
    for (const rule of ["'Jarvis — enceintes (TCP 53131)'", "'Jarvis — enceintes (mDNS)'"]) {
      expect(firewall).toContain(rule);
      expect(status).toContain(rule);
    }
  });
});
