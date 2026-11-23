import { describe, expect, it } from 'vitest';
import { aplatirPreset, imprimanteChoisie, rendreCompatible, volumeImprimante, type PresetOrca } from './orcaPresets.js';

describe('préréglages d’OrcaSlicer (copies pour la ligne de commande)', () => {
  const systeme: Record<string, PresetOrca[]> = {
    fdm_machine_common: [{ source: 'Custom/fdm_machine_common', fabricant: 'Custom', json: { name: 'fdm_machine_common', printable_height: '250', gcode_flavor: 'marlin' } }],
    fdm_klipper_common: [{ source: 'Custom/fdm_klipper_common', fabricant: 'Custom', json: { name: 'fdm_klipper_common', inherits: 'fdm_machine_common', gcode_flavor: 'klipper' } }],
    'MyKlipper 0.4 nozzle': [
      { source: 'Autre/MyKlipper', fabricant: 'Autre', json: { name: 'MyKlipper 0.4 nozzle', inherits: 'boucle' } },
      { source: 'Custom/MyKlipper', fabricant: 'Custom', json: { name: 'MyKlipper 0.4 nozzle', inherits: 'fdm_klipper_common', printable_area: ['0x0', '250x0', '250x250', '0x250'] } },
    ],
  };
  const trouver = (nom: string): PresetOrca[] => systeme[nom] ?? [];
  const copie: PresetOrca = {
    source: 'user/machine/copie',
    fabricant: 'Custom',
    json: { name: 'MyKlipper 0.4 nozzle - Copie', inherits: 'MyKlipper 0.4 nozzle', machine_start_gcode: 'PRINT_START' },
  };

  it('fusionne toute la chaîne, ajoute le type et garde le parent direct', () => {
    const a = aplatirPreset(copie, 'machine', trouver);
    expect(a.chaine).toEqual(['MyKlipper 0.4 nozzle - Copie', 'MyKlipper 0.4 nozzle', 'fdm_klipper_common', 'fdm_machine_common']);
    expect(a.json).toMatchObject({
      type: 'machine',
      from: 'User',
      inherits: 'MyKlipper 0.4 nozzle',
      gcode_flavor: 'klipper',
      machine_start_gcode: 'PRINT_START',
      name: 'MyKlipper 0.4 nozzle - Copie',
    });
    expect(volumeImprimante(a.json)).toEqual({ x: 250, y: 250, z: 250 });
  });

  it('ne modifie pas le préréglage de départ', () => {
    const avant = JSON.stringify(copie.json);
    aplatirPreset(copie, 'machine', trouver);
    expect(JSON.stringify(copie.json)).toBe(avant);
  });

  it('parent absent ou boucle : erreur dite', () => {
    expect(() => aplatirPreset({ source: 'x', fabricant: 'C', json: { name: 'x', inherits: 'absent' } }, 'process', trouver)).toThrow(/introuvable/);
    const boucle = (nom: string): PresetOrca[] => [{ source: nom, fabricant: 'C', json: { name: nom, inherits: nom === 'a' ? 'b' : 'a' } }];
    expect(() => aplatirPreset({ source: 'u', fabricant: 'C', json: { name: 'u', inherits: 'a' } }, 'process', boucle)).toThrow(/boucle/);
  });

  it('compatibilité : ajoute l’imprimante de l’utilisateur sans rien retirer', () => {
    expect(rendreCompatible({ compatible_printers: ['A'] }, 'A - Copie')).toEqual({ compatible_printers: ['A', 'A - Copie'] });
    expect(rendreCompatible({ compatible_printers: [] }, 'X')).toEqual({ compatible_printers: [] });
  });

  it('imprimante choisie dans OrcaSlicer.conf', () => {
    expect(imprimanteChoisie('{"presets":{"machine":"MyKlipper 0.4 nozzle - Copie"}}')).toBe('MyKlipper 0.4 nozzle - Copie');
    expect(imprimanteChoisie('pas du json')).toBeNull();
  });
});
