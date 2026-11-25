import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  aMesurer,
  brocheCarte,
  comparerCablage,
  consigneCablage,
  lireDefines,
  lireReponseCablage,
  questionCablage,
  RAPPEL_CABLAGE,
  referenceDemandee,
  referenceEnceinte,
  reponseCablage,
  type FilVu,
} from './cablage.js';

const CONFIG_H = readFileSync(fileURLToPath(new URL('../../../../firmware/jarvis-speaker/include/config.h', import.meta.url)), 'utf8');

function fil(module: string, broche: string, carte: string, sur = true): FilVu {
  return { couleur: '', module, broche, carte, sur };
}

describe('référence de l’enceinte lue dans config.h', () => {
  it('le vrai config.h donne les broches du micro, de l’ampli et de l’écran', () => {
    const ref = referenceEnceinte(CONFIG_H);
    expect(ref.manquantes).toEqual([]);
    const vues = ref.liaisons.map((l) => `${l.module} ${l.broche}=${l.carte}`);
    expect(vues).toEqual([
      'micro SCK=4',
      'micro WS=5',
      'micro SD=6',
      'ampli BCLK=15',
      'ampli LRC=16',
      'ampli DIN=17',
      'ecran SDA=8',
      'ecran SCL=9',
      'micro L/R=GND',
      'ecran GND=GND',
      'ecran VCC=3V3',
    ]);
    expect(ref.liaisons.find((l) => l.broche === 'VCC')!.critique).toBe(true);
  });
  it('suit le fichier : une broche changée change la référence ; une constante absente est dite', () => {
    const autre = CONFIG_H.replace(/#define MIC_PIN_SCK\s+4/, '#define MIC_PIN_SCK   7').replace(/#define AMP_PIN_DIN[^\n]*\n/, '');
    const ref = referenceEnceinte(autre);
    expect(ref.liaisons.find((l) => l.module === 'micro' && l.broche === 'SCK')!.carte).toBe('7');
    expect(ref.manquantes).toEqual(['AMP_PIN_DIN']);
  });
  it('écran coupé : ses liaisons ne comptent pas', () => {
    const ref = referenceEnceinte(CONFIG_H.replace(/#define DISPLAY_ENABLED\s+1/, '#define DISPLAY_ENABLED 0'));
    expect(ref.liaisons.some((l) => l.module === 'ecran')).toBe(false);
  });
  it('lit les #define sans les commentaires', () => {
    expect(lireDefines('#define A  4    // x\n#define B 0x3C /* y */\n// #define C 1').get('A')).toBe('4');
    expect(lireDefines('#define B 0x3C /* y */').get('B')).toBe('0x3C');
  });
});

describe('questions', () => {
  it('reconnaît une question de câblage et la référence de l’enceinte', () => {
    expect(questionCablage('mon câblage est bon ?')).toBe(true);
    expect(questionCablage("j'ai bien branché le micro ?")).toBe(true);
    expect(questionCablage("c'est quoi ce composant ?")).toBe(false);
    expect(referenceDemandee("vérifie le câblage de l'enceinte")).toBe('enceinte');
    expect(referenceDemandee('le MAX98357A est bien branché ?')).toBe('enceinte');
    expect(referenceDemandee('mon câblage est bon ?')).toBeNull();
  });
  it('la consigne des yeux nomme les modules, jamais les broches attendues', () => {
    const c = consigneCablage(referenceEnceinte(CONFIG_H));
    expect(c).toContain('INMP441');
    // Aucune broche de la carte attendue (4, 5, 6, 8, 9, 15, 16, 17), même en exemple.
    expect(c).not.toMatch(/\b(?:4|5|6|8|9|15|16|17)\b/);
  });
});

describe('lecture des fils vus', () => {
  it('lit le JSON des yeux et écarte un fil sans broche', () => {
    const l = lireReponseCablage(
      '```json\n{"description":"Une carte et un micro.","fils":[{"couleur":"rouge","module":"INMP441","broche":"SCK","carte":"GPIO4","sur":true},{"couleur":"noir"}],"doutes":["fils cachés"]}\n```',
    );
    expect(l.fils).toEqual([{ couleur: 'rouge', module: 'INMP441', broche: 'SCK', carte: 'GPIO4', sur: true }]);
    expect(l.doutes).toEqual(['fils cachés']);
  });
  it('un texte libre ne donne aucun fil', () => {
    const l = lireReponseCablage('Je vois des fils de couleurs.');
    expect(l.brute).toBe(true);
    expect(l.fils).toEqual([]);
  });
  it('normalise les broches de la carte', () => {
    expect(['GPIO04', 'IO4', 'G4', '4', 'io 4'].map(brocheCarte)).toEqual(['4', '4', '4', '4', '4']);
    expect(['3.3V', '3,3V', '3V3'].map(brocheCarte)).toEqual(['3V3', '3V3', '3V3']);
    expect(['GND', 'masse'].map(brocheCarte)).toEqual(['GND', 'GND']);
    expect(brocheCarte('1?')).toBe('?');
  });
});

describe('comparaison avec la référence', () => {
  const ref = referenceEnceinte(CONFIG_H);
  it('conforme, différent, incertain, non vu', () => {
    const c = comparerCablage(ref, [
      fil('INMP441', 'SCK', 'GPIO4'),
      fil('micro', 'WS', 'IO6'),
      fil('INMP441', 'SD', '6', false),
      fil('MAX98357A', 'LRCLK', '16'),
    ]);
    const etat = (m: string, b: string) => c.liaisons.find((l) => l.liaison.module === m && l.liaison.broche === b)!.etat;
    expect(etat('micro', 'SCK')).toBe('conforme');
    expect(etat('micro', 'WS')).toBe('different');
    expect(etat('micro', 'SD')).toBe('incertain');
    expect(etat('ampli', 'LRC')).toBe('conforme');
    expect(etat('ampli', 'DIN')).toBe('non-vu');
    expect(c.conflits).toEqual(['GPIO 6 : micro INMP441 WS et micro INMP441 SD']);
  });
  it('un module inconnu ou une broche hors référence est dit, jamais rattaché au hasard', () => {
    const c = comparerCablage(ref, [fil('ESP32', 'TX', '43'), fil('MAX98357A', 'VIN', '5V')]);
    expect(c.inconnus.map((i) => i.raison)).toEqual(['module « ESP32 » non reconnu', 'broche « VIN » absente de la référence pour ce module']);
  });
  it('sans nom de module, une broche propre à un seul module le désigne', () => {
    const c = comparerCablage(ref, [fil('', 'BCLK', '15')]);
    expect(c.liaisons.find((l) => l.liaison.broche === 'BCLK')!.etat).toBe('conforme');
  });
  it('l’écran en 5 V est vu comme différent ; la tension est à mesurer', () => {
    const c = comparerCablage(ref, [fil('OLED', 'VCC', '5V')]);
    expect(c.liaisons.find((l) => l.liaison.broche === 'VCC')!.etat).toBe('different');
    expect(aMesurer(c).join('\n')).toMatch(/environ 3,3 V, jamais 5 V/);
  });
});

describe('réponse', () => {
  const ref = referenceEnceinte(CONFIG_H);
  it('jamais « c’est bon », même quand tout ce qui est vu correspond', () => {
    const fils = ref.liaisons.map((l) => fil(l.module === 'micro' ? 'INMP441' : l.module === 'ampli' ? 'MAX98357A' : 'OLED', l.broche, l.carte));
    const c = comparerCablage(ref, fils);
    expect(c.liaisons.every((l) => l.etat === 'conforme')).toBe(true);
    const r = reponseCablage({ comparaison: c, lecture: { description: '', fils, doutes: [], brute: false }, modeleVision: 'gemma3:4b', oral: false });
    expect(r).toContain(RAPPEL_CABLAGE);
    expect(r).toContain('pas une preuve');
    expect(r).not.toMatch(/c[’']est bon|câblage est correct/i);
    expect(r).toContain('gemma3:4b');
  });
  it('les différences viennent en premier ; à l’oral, court', () => {
    const lecture = { description: 'Une carte.', fils: [fil('INMP441', 'SCK', '5')], doutes: ['photo sombre'], brute: false };
    const c = comparerCablage(ref, lecture.fils);
    const r = reponseCablage({ comparaison: c, lecture, modeleVision: 'gemma3:4b', oral: false });
    expect(r.indexOf('Différent')).toBeLessThan(r.indexOf('Pas vu'));
    expect(r).toContain('micro INMP441 SCK : attendu GPIO 4, je vois GPIO 5 (MIC_PIN_SCK = 4)');
    expect(r).toContain('Doutes des yeux : photo sombre.');
    const oral = reponseCablage({ comparaison: c, lecture, modeleVision: 'gemma3:4b', oral: true });
    expect(oral).toContain('1 différence');
    expect(oral).toContain(RAPPEL_CABLAGE);
  });
  it('aucun fil suivi : rien n’est comparé, et c’est dit', () => {
    const lecture = { description: '', fils: [], doutes: [], brute: true };
    const r = reponseCablage({ comparaison: comparerCablage(ref, []), lecture, modeleVision: 'gemma3:4b', oral: false });
    expect(r).toContain("n'ont suivi aucun fil");
    expect(r).not.toContain('correspond à la référence');
  });
});
