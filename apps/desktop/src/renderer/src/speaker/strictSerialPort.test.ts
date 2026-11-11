import { describe, expect, it } from 'vitest';
import { installSpeaker } from './installDriver.js';
import { textLink } from './esptoolFlash.js';
import { PortBank, StrictSerialPort } from './strictSerialPort.js';

const TOKEN = 'cd'.repeat(32);

describe('faux port Web Serial', () => {
  it('refuse une seconde ouverture, un second verrou, et jette les données annulées', async () => {
    const port = new StrictSerialPort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    await port.open({ baudRate: 115200 });
    await expect(port.open({ baudRate: 115200 })).rejects.toThrow(/déjà ouvert/);
    const reader = port.readable?.getReader();
    expect(reader).toBeTruthy();
    expect(() => port.readable?.getReader()).toThrow();
    port.pushText('JARVIS> {"fw":"perdu"}\n');
    await reader?.cancel();
    expect(port.dropped).toBeGreaterThan(0);
    reader?.releaseLock();
    const writer = port.writable?.getWriter();
    expect(() => port.writable?.getWriter()).toThrow();
    writer?.releaseLock();
    const again = port.writable?.getWriter();
    expect(again).toBeTruthy();
    again?.releaseLock();
    await port.close();
  });

  it('ferme le port avant le programmeur et retrouve la prise USB native', async () => {
    const bank = new PortBank();
    let current = bank.add({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    await current.open({ baudRate: 115200 });
    const link = textLink(current);
    const openedWhileClosed: boolean[] = [];
    const result = await installSpeaker({
      link,
      manifestVersion: '5.0.75',
      helloTimeoutMs: 40,
      helloAfterFlashMs: 300,
      wifi: { name: 'Salon', ssid: 'synthetique-test', pass: 'motdepasse' },
      closePort: async () => {
        await current.close();
      },
      findPort: async () => {
        const next = bank.getPorts().find((port) => port.info.usbVendorId === 0x303a);
        if (!next) return;
        current = next;
        await link.attach(next);
      },
      flasher: {
        async identify() {
          openedWhileClosed.push(!current.opened);
          if (current.opened) throw new Error('Le port est encore ouvert.');
          await current.open({ baudRate: 115200 });
          return { ok: true, name: 'ESP32-S3', flashBytes: 16 * 1024 * 1024 };
        },
        async flash(onProgress) {
          onProgress(100);
          return true;
        },
        async reboot() {
          await current.close();
          bank.drop(current);
          const born = bank.add({ usbVendorId: 0x303a, usbProductId: 0x1001 });
          born.onWrite = (text) => {
            if (text.includes('hello')) {
              born.pushText('I (3) jarvis: bruit\nJARVIS> {"fw":"5.0.75","mac":"aa:bb:cc:dd:ee:ff","configured":false}\n');
            } else if (text.startsWith('scan')) {
              born.pushText('JARVIS> {"networks":[{"ssid":"synthetique-test","rssi":-40,"secure":true}]}\n');
            } else if (text.startsWith('config')) {
              born.pushText('JARVIS> {"ok":true}\n');
            } else if (text.startsWith('test')) {
              born.pushText('JARVIS> {"step":"wifi","ok":true}\nJARVIS> {"step":"pc","ok":true}\nJARVIS> {"step":"bridge","ok":true}\nJARVIS> {"step":"voice","ok":true}\n');
            }
          };
        },
      },
      pair: async () => ({ speakerId: 'spk', token: TOKEN, pcId: 'ab12cd34', port: 53131, hosts: ['192.168.1.20'] }),
      commit: async () => undefined,
      abandon: async () => undefined,
    });
    expect(openedWhileClosed).toEqual([true]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mac).toBe('aa:bb:cc:dd:ee:ff');
  });
});
