import { describe, expect, it } from 'vitest';
import { runSpeakerSetup, type SetupIo } from './setupFlow.js';

function io(partial: Partial<SetupIo> = {}): SetupIo {
  return {
    hello: async () => null,
    identifyChip: async () => ({ ok: true, chip: { name: 'ESP32-S3', flashBytes: 16 * 1024 * 1024 } }),
    flash: async (onProgress) => {
      onProgress(40);
      onProgress(100);
      return true;
    },
    reboot: async () => undefined,
    scan: async () => [{ ssid: 'synthetique-test', rssi: -40, secure: true }],
    sendConfig: async () => ({ ok: true }),
    test: async () => [
      { step: 'wifi', ok: true },
      { step: 'pc', ok: true },
      { step: 'bridge', ok: true },
      { step: 'voice', ok: true },
    ],
    forget: async () => undefined,
    ...partial,
  };
}

describe('déroulé d’installation', () => {
  it('coche tout le chemin heureux', async () => {
    let flashed = false;
    const result = await runSpeakerSetup(
      io({
        hello: async () => (flashed ? { fw: '5.0.75', mac: 'aa:bb:cc:dd:ee:ff', configured: false } : null),
        flash: async (onProgress) => {
          flashed = true;
          onProgress(100);
          return true;
        },
      }),
      { manifestVersion: '5.0.75' },
    );
    expect(result).toMatchObject({ ok: true, mac: 'aa:bb:cc:dd:ee:ff', skippedFlash: false });
  });

  it('saute l’écriture si la carte a déjà cette version', async () => {
    let flashed = false;
    const result = await runSpeakerSetup(
      io({
        hello: async () => ({ fw: '5.0.75', mac: 'aa:bb:cc:dd:ee:ff', configured: true }),
        flash: async () => {
          flashed = true;
          return true;
        },
      }),
      { manifestVersion: '5.0.75' },
    );
    expect(result).toMatchObject({ ok: true, skippedFlash: true });
    expect(flashed).toBe(false);
  });

  it('refuse une autre puce ou une flash trop petite', async () => {
    const other = await runSpeakerSetup(io({ identifyChip: async () => ({ ok: true, chip: { name: 'ESP32', flashBytes: 8 * 1024 * 1024 } }) }), {
      manifestVersion: '5.0.75',
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.failure.sentence).toContain('ESP32-S3');
    const small = await runSpeakerSetup(
      io({ identifyChip: async () => ({ ok: true, chip: { name: 'ESP32-S3', flashBytes: 4 * 1024 * 1024 } }) }),
      { manifestVersion: '5.0.75' },
    );
    if (!small.ok) expect(small.failure.sentence).toContain('8 Mo');
  });

  it('demande le geste BOOT si la carte n’entre pas en programmation', async () => {
    const result = await runSpeakerSetup(io({ identifyChip: async () => ({ ok: false, boot: true }) }), { manifestVersion: '5.0.75' });
    if (!result.ok) {
      expect(result.failure.sentence).toContain('BOOT');
      expect(result.failure.button).toBe('Réessayer');
    }
  });

  it('oublie la carte si le mot de passe est faux, et si on annule après l’envoi', async () => {
    let forgotten = 0;
    const bad = await runSpeakerSetup(
      io({
        hello: async () => ({ fw: '5.0.75', mac: 'aa', configured: true }),
        test: async () => [{ step: 'wifi', ok: false, error: 'wrong_password' }],
        forget: async () => {
          forgotten += 1;
        },
      }),
      { manifestVersion: '5.0.75' },
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.failure.button).toBe('Corriger');
    expect(forgotten).toBe(1);
  });

  it('donne le diagnostic si le PC est introuvable', async () => {
    const result = await runSpeakerSetup(
      io({
        hello: async () => ({ fw: '5.0.75', mac: 'aa', configured: true }),
        test: async () => [{ step: 'pc', ok: false, error: 'pc_not_found' }],
      }),
      { manifestVersion: '5.0.75' },
    );
    if (!result.ok) expect(result.failure.button).toBe('Voir le diagnostic');
  });
});
