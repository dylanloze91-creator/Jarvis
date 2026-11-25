import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { FakeMoonraker } from './fakeMoonraker.testkit.js';
import {
  MoonrakerClient,
  MoonrakerError,
  SPEAKER_CANNOT_START,
  formatPrintStatus,
  printerIntent,
  startPrintWatch,
} from './moonraker.js';

const LOCAL = 'http://printer.local:7125';

function client(fake: FakeMoonraker, url = LOCAL) {
  return new MoonrakerClient(url, 'synthetique-test-cle', fake.fetch);
}

describe('Moonraker', () => {
  it('parseSettings({}) ne gagne pas la clé printer', () => {
    expect(parseSettings({})).not.toHaveProperty('printer');
  });

  it('une adresse Internet est refusée sans aucun appel', async () => {
    const fake = new FakeMoonraker();
    expect(() => client(fake, 'https://example.com')).toThrow(MoonrakerError);
    expect(fake.calls).toEqual([]);
  });

  it('état, fichiers, lancement relu, pause, annulation', async () => {
    const fake = new FakeMoonraker();
    const printer = client(fake);
    const idle = await printer.status();
    expect(formatPrintStatus(idle)).toContain('standby');
    expect(await printer.files()).toEqual([{ path: 'synthetique-test.gcode', size: 12 }]);
    const started = await printer.start('synthetique-test.gcode');
    expect(started.state).toBe('printing');
    expect(started.filename).toBe('synthetique-test.gcode');
    const paused = await printer.pause();
    expect(paused.state).toBe('paused');
    const resumed = await printer.resume();
    expect(resumed.state).toBe('printing');
    const cancelled = await printer.cancel();
    expect(cancelled.state).toBe('cancelled');
    expect(fake.apiKeys.every((key) => key === 'synthetique-test-cle')).toBe(true);
    await printer.upload('synthetique-test.gcode', new Uint8Array([1, 2]), true);
    expect(fake.calls).toContain('POST /server/files/upload');
  });

  it('file d’attente : réglages, envoi sans lancer, ajout, relecture, retrait ; l’impression en cours ne bouge pas', async () => {
    const fake = new FakeMoonraker();
    const printer = client(fake);
    expect(await printer.queueSettings()).toEqual({ active: true, passageAuto: false, chargeAuDemarrage: false });
    fake.status = { ...fake.status, state: 'printing', filename: 'synthetique-test.gcode', progress: 0.4 };
    await printer.upload('synthetique-test-2.gcode', new Uint8Array([1]), false);
    expect((await printer.status()).filename).toBe('synthetique-test.gcode');
    const ajout = await printer.queueAdd('synthetique-test-2.gcode');
    expect(ajout.jobs.map((j) => j.filename)).toEqual(['synthetique-test-2.gcode']);
    expect(ajout.state).toBe('paused');
    expect(await printer.queueStatus()).toEqual(ajout);
    expect(fake.calls).not.toContain('POST /server/job_queue/start');
    expect(fake.calls).not.toContain('POST /printer/print/start');
    // Fin de l'impression : la file en pause ne lance rien.
    fake.finishPrint();
    expect((await printer.status()).state).toBe('complete');
    const vide = await printer.queueRemove(ajout.jobs[0]!.jobId);
    expect(vide.jobs).toEqual([]);
    // Fichier absent de l'imprimante : Moonraker refuse l'ajout.
    await expect(printer.queueAdd('absent.gcode')).rejects.toThrow(MoonrakerError);
  });

  it('file d’attente : passage automatique et chargement au démarrage lus ; section absente', async () => {
    const fake = new FakeMoonraker();
    fake.jobQueue = { automatic_transition: 'True', load_on_startup: 'false' };
    expect(await client(fake).queueSettings()).toEqual({ active: true, passageAuto: true, chargeAuDemarrage: false });
    fake.jobQueue = null;
    expect((await client(fake).queueSettings()).active).toBe(false);
    await expect(client(fake).queueStatus()).rejects.toThrow(MoonrakerError);
  });

  it('phrases express, enceinte, fin signalée une seule fois', async () => {
    expect(printerIntent("où en est l'impression")?.kind).toBe('status');
    expect(printerIntent("mets l'impression en pause")?.kind).toBe('pause');
    expect(printerIntent("annule l'impression")?.kind).toBe('cancel');
    expect(printerIntent('imprime le fichier synthetique-test.gcode')).toEqual({
      kind: 'start',
      filename: 'synthetique-test.gcode',
    });
    expect(printerIntent('Le film était bien')).toBeNull();
    expect(SPEAKER_CANNOT_START).toMatch(/PC ou le téléphone/);

    const seen: string[] = [];
    const states = ['printing', 'complete', 'complete'];
    const watch = startPrintWatch({
      intervalMs: 60_000,
      read: async () => ({
        state: states.shift() ?? 'standby',
        filename: 'synthetique-test.gcode',
        progress: 1,
        printDuration: 8040,
        totalDuration: 8040,
        bed: 60,
        bedTarget: 60,
        extruder: 200,
        extruderTarget: 200,
      }),
      onDone: (message) => seen.push(message),
      schedule: (run) => {
        run();
        run();
        run();
        return { cancel() {} };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    watch.stop();
    expect(seen).toEqual(["L'impression de synthetique-test.gcode est terminée (2 h 14)."]);
  });
});
