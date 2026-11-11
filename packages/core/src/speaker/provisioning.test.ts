import { describe, expect, it } from 'vitest';
import { autoEspressif, rankSerialPorts } from './ports.js';
import {
  buildConfigLine,
  failureCopy,
  fiveGhzWarning,
  readWifiScan,
  redactProvision,
  takeJarvisMessages,
  validateProvision,
  type ProvisionConfig,
} from './provisioning.js';

const token = 'ab'.repeat(32);

function config(partial: Partial<ProvisionConfig> = {}): ProvisionConfig {
  return {
    ssid: 'synthetique-test',
    pass: 'motdepasse',
    name: 'Salon',
    token,
    pcId: 'ab12cd34',
    port: 53131,
    hosts: ['192.168.1.20'],
    ...partial,
  };
}

describe('protocole d’installation', () => {
  it('construit la ligne config et masque le mot de passe', () => {
    const line = buildConfigLine(config());
    expect(line.startsWith('config {')).toBe(true);
    expect(JSON.parse(line.slice('config '.length))).toMatchObject({ ssid: 'synthetique-test', port: 53131 });
    const journal = `I (12) jarvis: ${line}`;
    expect(redactProvision(journal)).not.toContain('motdepasse');
    expect(redactProvision(journal)).toContain('"pass":"***"');
    expect(redactProvision(journal)).toContain('synthetique-test');
  });

  it('refuse les longueurs et les caractères interdits', () => {
    expect(validateProvision(config({ ssid: '' })).ok).toBe(false);
    expect(validateProvision(config({ pass: 'court' }))).toMatchObject({ error: 'pass' });
    expect(validateProvision(config({ pass: '' })).ok).toBe(true);
    expect(validateProvision(config({ name: 'x'.repeat(25) }))).toMatchObject({ error: 'name' });
    expect(validateProvision(config({ token: 'zzzz' }))).toMatchObject({ error: 'token' });
    expect(validateProvision(config({ pcId: 'court' }))).toMatchObject({ error: 'pc_id' });
    expect(validateProvision(config({ port: 0 }))).toMatchObject({ error: 'port' });
    expect(validateProvision(config({ hosts: ['256.1.1.1'] }))).toMatchObject({ error: 'hosts' });
    expect(validateProvision(config({ hosts: ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5'] }))).toMatchObject({
      error: 'hosts',
    });
  });

  it('lit JARVIS> au milieu d’un journal bruité', () => {
    const noisy = [
      'I (10) jarvis: pret',
      'JARVIS> {"fw":"5.0.75","chip":"ESP32-S3","configured":false}',
      'W (20) wifi: retry',
      'JARVIS> {"step":"wifi","ok":false,"error":"wrong_password"}',
      'JARVIS> {pas du json',
      'moitie',
    ].join('\n');
    const parsed = takeJarvisMessages(noisy);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1]?.json).toMatchObject({ step: 'wifi', error: 'wrong_password' });
    expect(parsed.rest).toBe('moitie');
  });

  it('trie le scan et traduit les échecs', () => {
    const networks = readWifiScan({
      networks: [
        { ssid: 'synthetique-test', rssi: -70, secure: true },
        { ssid: 'synthetique-test', rssi: -40, secure: true },
        { ssid: 'autre', rssi: -50, secure: false },
      ],
    });
    expect(networks.map((item) => item.ssid)).toEqual(['synthetique-test', 'autre']);
    expect(networks[0]?.rssi).toBe(-40);
    expect(failureCopy('wrong_password').sentence).toContain('mot de passe');
    expect(failureCopy('wrong_password').button).toBe('Corriger');
    expect(failureCopy('pc_not_found').button).toBe('Voir le diagnostic');
  });

  it('avertit si le PC est en 5 GHz et que l’enceinte ne voit pas ce nom', () => {
    expect(fiveGhzWarning('Maison-5', '5 GHz', [])).toContain('2,4 GHz');
    expect(fiveGhzWarning('Maison-5', '5 GHz', [{ ssid: 'Maison-5', rssi: -40, secure: true }])).toBeNull();
    expect(fiveGhzWarning('Maison', '2.4 GHz', [])).toBeNull();
  });
});

describe('ports série', () => {
  it('met la carte Espressif devant et la choisit seule s’il n’y en a qu’une', () => {
    const ranked = rankSerialPorts([
      { portId: 'a', usbVendorId: 0x0403, portName: 'COM9' },
      { portId: 'b', usbVendorId: 0x303a, portName: 'COM5' },
      { portId: 'c', portName: 'COM3' },
    ]);
    expect(ranked[0]).toMatchObject({ portId: 'b', label: 'Carte ESP32-S3 (COM5)', espressif: true });
    expect(autoEspressif(ranked)?.portId).toBe('b');
    const two = rankSerialPorts([
      { portId: 'b', usbVendorId: 0x303a, portName: 'COM5' },
      { portId: 'd', usbVendorId: 0x303a, portName: 'COM6' },
    ]);
    expect(autoEspressif(two)).toBeNull();
  });
});
