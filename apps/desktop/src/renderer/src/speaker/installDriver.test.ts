import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChipFlasher } from './installDriver.js';
import { SCAN_TIMEOUT_MS, TEST_STEP_TIMEOUT_MS, installSpeaker } from './installDriver.js';
import { FakeSpeakerLink } from './fakeSerial.testkit.js';

const TOKEN = 'ab'.repeat(32);
const PASS = 'motdepasse';

function flasher(link: FakeSpeakerLink, partial: { name?: string; flashBytes?: number; boot?: boolean; flashOk?: boolean } = {}): ChipFlasher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async identify() {
      calls.push('identify');
      if (partial.boot) return { ok: false, boot: true };
      return { ok: true, name: partial.name ?? 'ESP32-S3', flashBytes: partial.flashBytes ?? 16 * 1024 * 1024 };
    },
    async flash(onProgress) {
      calls.push('flash');
      onProgress(40);
      onProgress(100);
      if (partial.flashOk === false) return false;
      link.markFlashed();
      return true;
    },
    async reboot() {
      calls.push('reboot');
    },
  };
}

function request(link: FakeSpeakerLink, chip: ReturnType<typeof flasher>, extra: Partial<Parameters<typeof installSpeaker>[0]> = {}) {
  const logs: string[] = [];
  const paired: string[] = [];
  const committed: string[] = [];
  const abandoned: string[] = [];
  const run = installSpeaker({
    link,
    flasher: chip,
    manifestVersion: '5.0.75',
    wifi: { name: 'Salon', ssid: 'synthetique-test', pass: PASS },
    pair: async (mac) => {
      paired.push(mac);
      return { speakerId: 'spk-1', token: TOKEN, pcId: 'ab12cd34', port: 53131, hosts: ['192.168.1.20'] };
    },
    commit: async (id, fw) => {
      committed.push(`${id}:${fw}`);
    },
    abandon: async (id) => {
      abandoned.push(id);
    },
    log: (line) => logs.push(line),
    helloTimeoutMs: 30,
    helloAfterFlashMs: 30,
    ...extra,
  });
  return { run, logs, paired, committed, abandoned };
}

describe('Installer programme la carte (faux port, esptool simulé)', () => {
  it('écrit le programme puis envoie le Wi-Fi, et le journal ne contient pas le mot de passe', async () => {
    const link = new FakeSpeakerLink({
      beforeFlash: null,
      afterFlash: { fw: '5.0.75', mac: 'aa:bb:cc:dd:ee:ff', configured: false },
    });
    const chip = flasher(link);
    const { run, logs, paired, committed, abandoned } = request(link, chip);
    const result = await run;
    expect(result).toMatchObject({ ok: true, mac: 'aa:bb:cc:dd:ee:ff', skippedFlash: false });
    expect(chip.calls).toEqual(['identify', 'flash', 'reboot']);
    const config = link.sent.find((line) => line.startsWith('config ')) ?? '';
    expect(config).toContain(PASS);
    expect(config).toContain('synthetique-test');
    expect(logs.join('\n')).not.toContain(PASS);
    expect(logs.join('\n')).toContain('***');
    expect(paired).toEqual(['aa:bb:cc:dd:ee:ff']);
    expect(committed).toEqual(['spk-1:5.0.75']);
    expect(abandoned).toEqual([]);
    expect(link.forgotten).toBe(0);
  });

  it('saute l’écriture si la même version répond déjà', async () => {
    const link = new FakeSpeakerLink({
      beforeFlash: { fw: '5.0.75', mac: 'aa:bb:cc:dd:ee:ff', configured: true },
    });
    const chip = flasher(link);
    const { run } = request(link, chip);
    const result = await run;
    expect(result).toMatchObject({ ok: true, skippedFlash: true });
    expect(chip.calls).toEqual([]);
    expect(link.sent.some((line) => line.startsWith('config '))).toBe(true);
  });

  it('refuse une autre puce, une flash trop petite, et le mode programmation', async () => {
    const other = new FakeSpeakerLink({ beforeFlash: null });
    const otherChip = flasher(other, { name: 'ESP32' });
    const otherRun = request(other, otherChip);
    const refused = await otherRun.run;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.failure.sentence).toContain('ESP32-S3');
    expect(otherChip.calls).toEqual(['identify']);
    expect(otherRun.paired).toEqual([]);

    const small = new FakeSpeakerLink({ beforeFlash: null });
    const smallChip = flasher(small, { flashBytes: 4 * 1024 * 1024 });
    const smallResult = await request(small, smallChip).run;
    expect(smallResult.ok).toBe(false);
    if (!smallResult.ok) expect(smallResult.failure.sentence).toContain('8 Mo');

    const boot = new FakeSpeakerLink({ beforeFlash: null });
    const bootChip = flasher(boot, { boot: true });
    const bootResult = await request(boot, bootChip).run;
    expect(bootResult.ok).toBe(false);
    if (!bootResult.ok) {
      expect(bootResult.failure.sentence).toContain('BOOT');
      expect(bootResult.failure.button).toBe('Réessayer');
    }
  });

  it('dit si l’écriture s’arrête', async () => {
    const link = new FakeSpeakerLink({ beforeFlash: null });
    const chip = flasher(link, { flashOk: false });
    const result = await request(link, chip).run;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.sentence).toContain('écriture');
    expect(link.sent.some((line) => line.startsWith('config '))).toBe(false);
  });

  it('oublie la carte si le mot de passe est faux ou si le PC est introuvable', async () => {
    const badPass = new FakeSpeakerLink({
      beforeFlash: { fw: '5.0.75', mac: 'aa:bb:cc:dd:ee:01', configured: true },
      steps: [{ step: 'wifi', ok: false, error: 'wrong_password' }],
    });
    const passRun = request(badPass, flasher(badPass));
    const passResult = await passRun.run;
    expect(passResult.ok).toBe(false);
    if (!passResult.ok) expect(passResult.failure.button).toBe('Corriger');
    expect(badPass.forgotten).toBe(1);
    expect(passRun.abandoned).toEqual(['spk-1']);
    expect(passRun.committed).toEqual([]);
    expect(passRun.logs.join('\n')).not.toContain(PASS);

    const lost = new FakeSpeakerLink({
      beforeFlash: { fw: '5.0.75', mac: 'aa:bb:cc:dd:ee:02', configured: true },
      steps: [{ step: 'pc', ok: false, error: 'pc_not_found' }],
    });
    const lostResult = await request(lost, flasher(lost)).run;
    expect(lostResult.ok).toBe(false);
    if (!lostResult.ok) expect(lostResult.failure.button).toBe('Voir le diagnostic');
    expect(lost.forgotten).toBe(1);
  });

  it('attend les délais de la carte et choisit le Wi-Fi dans la liste du scan', async () => {
    const link = new FakeSpeakerLink({
      beforeFlash: { fw: '5.0.75', mac: 'aa:bb:cc:dd:ee:ff', configured: true },
      networks: [
        { ssid: 'Maison', rssi: -30, secure: true },
        { ssid: 'Invite', rssi: -70, secure: false },
      ],
    });
    const seen: string[] = [];
    const { run } = request(link, flasher(link), {
      chooseWifi: async (networks) => {
        seen.push(...networks.map((item) => item.ssid));
        return { name: 'Cuisine', ssid: 'Invite', pass: PASS };
      },
    });
    const result = await run;
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['Maison', 'Invite']);
    const config = link.sent.find((line) => line.startsWith('config ')) ?? '';
    expect(config).toContain('Invite');
    expect(config).not.toContain('synthetique-test');
    expect(TEST_STEP_TIMEOUT_MS).toEqual([25_000, 12_000, 8_000, 20_000]);
    expect(SCAN_TIMEOUT_MS).toBe(5_000);
    const source = readFileSync(new URL('./installDriver.ts', import.meta.url), 'utf8');
    expect(source).toContain('pull(TEST_STEP_TIMEOUT_MS[index] ?? 20_000)');
    expect(source).toContain("command('scan', SCAN_TIMEOUT_MS)");
  });

  it('change le Wi-Fi sans réécrire le programme ni la clé', async () => {
    const link = new FakeSpeakerLink({
      beforeFlash: { fw: '5.0.75', mac: 'aa:bb:cc:dd:ee:ff', configured: true },
    });
    const chip = flasher(link);
    const { run, logs } = request(link, chip, {
      wifiOnly: true,
      chooseWifi: async () => ({ name: 'Salon', ssid: 'Nouveau', pass: PASS }),
    });
    const result = await run;
    expect(result.ok).toBe(true);
    expect(chip.calls).toEqual([]);
    const line = link.sent.find((item) => item.startsWith('wifi ')) ?? '';
    expect(line).toContain('Nouveau');
    expect(line).toContain(PASS);
    expect(logs.join('\n')).not.toContain(PASS);
    expect(link.sent.some((item) => item.startsWith('config '))).toBe(false);
  });

  it('refuse une carte sans adresse MAC au lieu d’inventer 00:00:00:00:00:00', async () => {
    const link = new FakeSpeakerLink({
      beforeFlash: { fw: '5.0.75', mac: '', configured: true },
    });
    const { run, paired } = request(link, flasher(link));
    const result = await run;
    expect(result.ok).toBe(false);
    expect(paired).toEqual([]);
  });
});
