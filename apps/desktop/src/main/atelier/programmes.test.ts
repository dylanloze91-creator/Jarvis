import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preparerPresetsOrca } from './programmes.js';

let racine: string;

async function ecrire(chemin: string, json: unknown): Promise<void> {
  await mkdir(join(chemin, '..'), { recursive: true });
  await writeFile(chemin, JSON.stringify(json), 'utf8');
}

beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), 'jarvis-orca-'));
  const sys = join(racine, 'system');
  await ecrire(join(sys, 'Custom', 'machine', 'fdm_klipper_common.json'), { type: 'machine', name: 'fdm_klipper_common', gcode_flavor: 'klipper', printable_height: '250' });
  await ecrire(join(sys, 'Custom', 'machine', 'MyKlipper 0.4 nozzle.json'), {
    type: 'machine',
    name: 'MyKlipper 0.4 nozzle',
    inherits: 'fdm_klipper_common',
    printable_area: ['0x0', '250x0', '250x250', '0x250'],
  });
  await ecrire(join(sys, 'Custom', 'process', '0.20mm Standard @MyKlipper.json'), {
    type: 'process',
    name: '0.20mm Standard @MyKlipper',
    layer_height: '0.2',
    compatible_printers: ['MyKlipper 0.4 nozzle'],
  });
  await ecrire(join(sys, 'OrcaFilamentLibrary', 'filament', 'base', 'fdm_filament_pet.json'), { type: 'filament', name: 'fdm_filament_pet', nozzle_temperature: ['240'] });
  await ecrire(join(sys, 'OrcaFilamentLibrary', 'filament', 'Generic PETG @System.json'), { type: 'filament', name: 'Generic PETG @System', inherits: 'fdm_filament_pet' });
  const u = join(racine, 'user', 'default');
  await ecrire(join(u, 'machine', 'Ma machine.json'), { name: 'Ma machine', inherits: 'MyKlipper 0.4 nozzle', from: 'User' });
  await ecrire(join(u, 'process', 'Mon reglage.json'), { name: 'Mon reglage', inherits: '0.20mm Standard @MyKlipper', enable_support: '1' });
  await ecrire(join(u, 'filament', 'Mon PETG.json'), { name: 'Mon PETG', inherits: 'Generic PETG @System', nozzle_temperature: ['245'], compatible_printers: ['MyKlipper 0.4 nozzle'] });
  await writeFile(join(racine, 'OrcaSlicer.conf'), JSON.stringify({ presets: { machine: 'Ma machine' } }), 'utf8');
});

afterEach(async () => {
  await rm(racine, { recursive: true, force: true });
});

describe('copies des préréglages d’OrcaSlicer', () => {
  it('lit les préréglages de l’utilisateur, écrit des copies aplaties ailleurs, ne touche à rien', async () => {
    const avant = await stat(join(racine, 'user', 'default', 'machine', 'Ma machine.json'));
    const sortie = join(racine, 'jarvis', '_orca');
    const c = await preparerPresetsOrca(sortie, {}, racine);
    expect(c.imprimante).toBe('Ma machine');
    expect(c.reglage).toBe('Mon reglage');
    expect(c.matiere).toBe('Mon PETG');
    expect(c.volume).toEqual({ x: 250, y: 250, z: 250 });

    const machine = JSON.parse(await readFile(c.machine, 'utf8'));
    expect(machine).toMatchObject({ type: 'machine', inherits: 'MyKlipper 0.4 nozzle', gcode_flavor: 'klipper' });
    const process = JSON.parse(await readFile(c.process, 'utf8'));
    expect(process).toMatchObject({ type: 'process', inherits: '0.20mm Standard @MyKlipper', enable_support: '1', layer_height: '0.2' });
    expect(process.compatible_printers).toEqual(['MyKlipper 0.4 nozzle', 'Ma machine']);
    const filament = JSON.parse(await readFile(c.filament, 'utf8'));
    expect(filament).toMatchObject({ type: 'filament', inherits: 'Generic PETG @System', nozzle_temperature: ['245'] });

    const apres = await stat(join(racine, 'user', 'default', 'machine', 'Ma machine.json'));
    expect(apres.mtimeMs).toBe(avant.mtimeMs);
    expect(JSON.parse(await readFile(join(racine, 'user', 'default', 'process', 'Mon reglage.json'), 'utf8'))).toEqual({
      name: 'Mon reglage',
      inherits: '0.20mm Standard @MyKlipper',
      enable_support: '1',
    });
  });

  it('sans OrcaSlicer : erreur dite', async () => {
    await expect(preparerPresetsOrca(join(racine, 'x'), {}, join(racine, 'absent'))).rejects.toThrow(/introuvables/);
  });

  it('préréglage nommé absent : erreur dite', async () => {
    await expect(preparerPresetsOrca(join(racine, 'x'), { imprimante: 'Inconnue' }, racine)).rejects.toThrow(/Inconnue/);
  });
});
