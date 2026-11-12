import { describe, expect, it } from 'vitest';
import { collectSpeakerNet, elevateCommand, psQuote, readOnlyStatus, repairFirewall, repairPrivate, statusArgs } from './repair.js';

const FROZEN = JSON.stringify({
  tcp53131: false,
  udp5353: false,
  profiles: [
    { index: 12, name: 'Wi-Fi', category: 'Public', addresses: ['192.168.1.20'] },
    { index: 18, name: 'Tailscale', category: 'Public', addresses: ['100.64.0.8'] },
  ],
});

describe('réparation des enceintes', () => {
  it('ne lance rien sans un clic, et refuse un index qui n’est pas la maison', async () => {
    const launched: string[][] = [];
    const deps = {
      readStatus: async () => FROZEN,
      elevate: async (_script: string, args: string[]) => {
        launched.push(args);
      },
    };
    expect(await readOnlyStatus(deps)).toBe(FROZEN);
    expect(launched).toEqual([]);
    const home = { index: 12, name: 'Wi-Fi', category: 'Public', addresses: ['192.168.1.20'] };
    const refused = await repairPrivate(18, home, 'speaker-private.ps1', deps);
    expect(refused.ok).toBe(false);
    expect(launched).toEqual([]);
    const badPort = await repairFirewall(0, 'speaker-firewall.ps1', deps);
    expect(badPort.ok).toBe(false);
    expect(launched).toEqual([]);
  });

  it('Réparer et Privé élèvent avec le seul nombre validé', async () => {
    const launched: string[][] = [];
    const deps = {
      readStatus: async () => FROZEN,
      elevate: async (_script: string, args: string[]) => {
        launched.push(args);
      },
    };
    const home = { index: 12, name: 'Wi-Fi', category: 'Public', addresses: ['192.168.1.20'] };
    expect((await repairFirewall(53131, 'speaker-firewall.ps1', deps)).ok).toBe(true);
    expect((await repairPrivate(12, home, 'speaker-private.ps1', deps)).ok).toBe(true);
    expect(launched).toEqual([
      ['-Port', '53131'],
      ['-InterfaceIndex', '12'],
    ]);
  });

  it('branche la lecture figée jusqu’aux phrases du panneau', async () => {
    const view = await collectSpeakerNet({
      platform: 'win32',
      read: async () => FROZEN,
      bridgeRunning: true,
      kept: ['192.168.1.20'],
      speakers: [],
      now: 0,
    });
    expect(view.homeIndex).toBe(12);
    expect(view.lines.find((line) => line.id === 'firewall-mdns')?.ok).toBe(false);
    expect(view.lines.find((line) => line.id === 'private')?.sentence).toContain('Public');
    expect(view.notice).toBeNull();
  });

  it('dit le refus de Windows tel quel', async () => {
    const deps = {
      readStatus: async () => FROZEN,
      elevate: async () => {
        throw new Error('The operation was canceled by the user');
      },
    };
    const result = await repairFirewall(53131, 'speaker-firewall.ps1', deps);
    expect(result).toEqual({ ok: false, sentence: "Windows n'a pas donné l'accord." });
  });

  it('lance ses scripts malgré une politique d’exécution Windows restrictive', () => {
    const script = 'C:\\Program Files\\Jarvis\\resources\\speaker-net-status.ps1';
    const read = statusArgs(script);
    expect(read).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]);
    const command = elevateCommand('C:\\Jarvis\\resources\\speaker-firewall.ps1', ['-Port', '53131']);
    expect(command).toBe(
      "Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','C:\\Jarvis\\resources\\speaker-firewall.ps1','-Port','53131'",
    );
    // -ExecutionPolicy doit précéder -File : après, PowerShell le passerait au script.
    expect(command.indexOf("'-ExecutionPolicy','Bypass'")).toBeLessThan(command.indexOf("'-File'"));
  });

  it('accepte un chemin d’installation avec des lettres accentuées, et rien de dangereux', () => {
    const script = 'C:\\Users\\Zoé Lefèvre\\AppData\\Local\\Programs\\Jarvis\\resources\\speaker-firewall.ps1';
    expect(psQuote(script)).toBe(`'${script}'`);
    expect(psQuote('C:\\Users\\Jérôme_Ñandú (x86)\\Jarvis-5.0\\a.ps1')).toContain('Jérôme_Ñandú');
    expect(elevateCommand(script, ['-Port', '53131'])).toContain(`'-File','${script}','-Port','53131'`);
    for (const bad of ["C:\\a'b.ps1", 'C:\\a"b.ps1', 'C:\\$(calc).ps1', 'C:\\a`b.ps1', 'C:\\a;b.ps1', 'a|b', 'a&b', 'a\nb', '']) {
      expect(() => psQuote(bad)).toThrow('argument refusé');
    }
  });
});
