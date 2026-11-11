import { describe, expect, it } from 'vitest';
import { parseSettings } from '@jarvis/core';
import { collectHealthReport, type HealthProbeSet } from './collect.js';

function probes(over: Partial<HealthProbeSet> = {}): HealthProbeSet {
  return {
    ollama: async () => ({ reachable: true, models: ['qwen2.5:3b'] }),
    voiceMissing: async () => 0,
    piperReady: async () => true,
    spotify: async () => ({ tokenOk: true, speakerVisible: true }),
    google: async () => ({ connected: true, needsReconsent: false }),
    phonePublished: async () => true,
    speakersHeard: async () => true,
    robotReachable: async () => true,
    printerReachable: async () => true,
    diskFree: async () => 20 * 1024 * 1024 * 1024,
    backupState: async () => ({ lastAt: Date.now(), ok: true }),
    vaultReady: async () => ({ encryptionAvailable: true, unreadable: false }),
    phoneEnabled: () => false,
    speakersEnabled: () => false,
    printerConfigured: () => false,
    ...over,
  };
}

describe('contrôles du bilan', () => {
  it('ne contrôle pas un service qui n’est pas réglé', async () => {
    let google = 0;
    let spotify = 0;
    let printer = 0;
    const report = await collectHealthReport(parseSettings({}), probes({
      google: async () => {
        google += 1;
        return { connected: false, needsReconsent: true };
      },
      spotify: async () => {
        spotify += 1;
        return { tokenOk: false, speakerVisible: false };
      },
      printerReachable: async () => {
        printer += 1;
        return false;
      },
    }));
    expect(google).toBe(0);
    expect(spotify).toBe(0);
    expect(printer).toBe(0);
    expect(report.items.some((item) => item.id === 'google' || item.id === 'spotify' || item.id === 'printer')).toBe(false);
    expect(report.banner).toBeNull();
  });

  it('un délai devient orange', async () => {
    const report = await collectHealthReport(
      parseSettings({ spotifyClientId: 'client-exemple' }),
      probes({
        spotify: () => new Promise(() => undefined),
      }),
      Date.now(),
      { each: 20, total: 200 },
    );
    expect(report.items.find((item) => item.id === 'spotify')?.level).toBe('orange');
  });

  it('une erreur de sonde n’est pas un délai dépassé', async () => {
    const report = await collectHealthReport(
      parseSettings({}),
      probes({
        diskFree: async () => {
          throw new Error('disque en panne');
        },
      }),
    );
    const disk = report.items.find((item) => item.id === 'disk');
    expect(disk?.level).toBe('red');
    expect(disk?.sentence).toContain('disque en panne');
    expect(disk?.sentence).not.toMatch(/à temps/);
  });

  it('un seul appel pour Ollama et la liste des modèles', async () => {
    let calls = 0;
    const report = await collectHealthReport(
      parseSettings({ provider: 'ollama', model: 'qwen2.5', fallbackModel: 'qwen2.5' }),
      probes({
        ollama: async () => {
          calls += 1;
          return { reachable: true, models: ['qwen2.5:7b'] };
        },
      }),
    );
    expect(calls).toBe(1);
    expect(report.items.some((item) => item.sentence.includes("n'est plus installé"))).toBe(true);
  });

  it('signale un modèle manquant et une enceinte invisible', async () => {
    const report = await collectHealthReport(
      parseSettings({
        provider: 'ollama',
        model: 'qwen2.5:3b',
        fallbackModel: 'qwen2.5:3b',
        spotifyClientId: 'client-exemple',
        spotifyDeviceName: 'Enceinte du salon',
        orchestra: { enabled: true, brain: 'qwen2.5:7b', teams: { musique: { model: 'qwen2.5:7b', place: 'carte' } } },
      }),
      probes({
        ollama: async () => ({ reachable: true, models: ['qwen2.5:3b'] }),
        spotify: async () => ({ tokenOk: true, speakerVisible: false }),
      }),
    );
    const model = report.items.find((item) => item.sentence.includes('qwen2.5:7b'));
    expect(model?.level).toBe('red');
    expect(model?.open).toBe('orchestra.brain');
    expect(report.items.find((item) => item.id === 'spotify')?.sentence).toMatch(/Enceinte du salon/);
  });
});
