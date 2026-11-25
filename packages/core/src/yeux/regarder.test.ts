import { describe, expect, it } from 'vitest';
import {
  ajouterFait,
  chercherReference,
  demandeReponseYeux,
  finirReponseYeux,
  lireReponseFaits,
  lireReponseVision,
  memeFait,
  pageDeLaReference,
  photoPourLesYeux,
  questionElectrique,
  RAPPEL_SECURITE,
  referencesLues,
  reponseYeuxSansModele,
  verifierFait,
  type FaitVerifie,
} from './regarder.js';

const PAGE_MAX = [
  'MAX98357A Class D Amplifier Breakout',
  'Overview',
  'The MAX98357A is a digital pulse-code modulation (PCM) input Class D power amplifier.',
  'It operates from a 2.5V to 5.5V supply and delivers 3.2W into a 4 ohm load at 5V.',
  'Pins: VIN, GND, SD, GAIN, DIN, BCLK, LRC.',
].join('\n');

describe('photo pour les yeux ou pour Imager', () => {
  it('une question sur la photo va aux yeux', () => {
    expect(photoPourLesYeux("c'est quoi ce composant ?")).toBe(true);
    expect(photoPourLesYeux('mon câblage est bon ?')).toBe(true);
    expect(photoPourLesYeux('Voici une photo.')).toBe(true);
    expect(photoPourLesYeux("qu'est-ce qui est écrit sur la puce ?")).toBe(true);
  });
  it('une demande d’image reste à Imager', () => {
    expect(photoPourLesYeux('fais-en un sticker')).toBe(false);
    expect(photoPourLesYeux('transforme-la en dessin animé')).toBe(false);
    expect(photoPourLesYeux('génère une image comme celle-ci en style anime')).toBe(false);
  });
});

describe('lecture de la réponse du modèle de vision', () => {
  it('lit le JSON demandé, même entouré de texte', () => {
    const v = lireReponseVision(
      'Voici :\n```json\n{"description": "Une petite carte bleue.", "texte_lu": ["MAX98357A", "GAIN"], "reponse": "Un ampli I2S.", "doutes": ["photo floue"]}\n```',
    );
    expect(v).toEqual({ description: 'Une petite carte bleue.', texteLu: ['MAX98357A', 'GAIN'], reponse: 'Un ampli I2S.', doutes: ['photo floue'], brute: false });
  });
  it('un texte libre devient la description, rien n’est inventé', () => {
    const v = lireReponseVision('Je vois une carte électronique.');
    expect(v.brute).toBe(true);
    expect(v.description).toBe('Je vois une carte électronique.');
    expect(v.texteLu).toEqual([]);
  });
  it('accepte une liste écrite en texte', () => {
    expect(lireReponseVision('{"texte_lu": "ESP32-S3-WROOM-1; N16R8"}').texteLu).toEqual(['ESP32-S3-WROOM-1', 'N16R8']);
  });
});

describe('références lues', () => {
  it('garde les références, pas les valeurs ni les broches', () => {
    expect(referencesLues(['MAX98357A', 'GAIN', '5V', 'GPIO12', '3V3', '100uF', 'IO8'])).toEqual(['MAX98357A']);
    expect(referencesLues(['ESP32-S3-WROOM-1', 'N16R8', 'NE555'], 3)).toEqual(['ESP32-S3-WROOM-1', 'N16R8', 'NE555']);
  });
  it('sans doublon, au plus deux par défaut, rien d’illisible', () => {
    expect(referencesLues(['INMP441', 'inmp441', 'AMS1?17', 'MAX98357A', 'NE555'])).toEqual(['INMP441', 'MAX98357A']);
  });
  it('une référence et son début (« MAX98357 », « MAX98357A ») : une seule, la plus complète', () => {
    expect(referencesLues(['MAX98357A', 'MAX98357', 'GAIN'])).toEqual(['MAX98357A']);
    expect(referencesLues(['MAX98357', 'INMP441', 'MAX98357A'])).toEqual(['MAX98357A', 'INMP441']);
  });
  it('ni heure ni date', () => {
    expect(referencesLues(['12:30', '2024-05-01', '10k', '4R7'])).toEqual([]);
  });
});

describe('vérification d’un fait trouvé sur une page', () => {
  it('fait gardé : extrait dans la page, nombres dans l’extrait', () => {
    expect(
      verifierFait(PAGE_MAX, 'MAX98357A', {
        fait: "Il s'alimente de 2,5 à 5,5 V.",
        extrait: 'It operates from a 2.5V to 5.5V supply and delivers 3.2W into a 4 ohm load at 5V.',
      }),
    ).toBeNull();
  });
  it('nombre inventé : refusé', () => {
    expect(
      verifierFait(PAGE_MAX, 'MAX98357A', { fait: 'Il donne 10 W.', extrait: 'It operates from a 2.5V to 5.5V supply and delivers 3.2W into a 4 ohm load at 5V.' }),
    ).toMatch(/nombre 10/);
  });
  it('extrait absent de la page : refusé', () => {
    expect(verifierFait(PAGE_MAX, 'MAX98357A', { fait: 'Il a un DAC.', extrait: 'It includes a 24-bit DAC with headphone output.' })).toMatch(/introuvable/);
  });
  it('page qui ne nomme pas la référence : refusée', () => {
    expect(verifierFait(PAGE_MAX, 'PAM8403', { fait: 'Ampli.', extrait: 'The MAX98357A is a digital pulse-code modulation (PCM) input Class D power amplifier.' })).toMatch(/ne nomme pas/);
  });
  it('page qui compare plusieurs pièces : la ligne doit nommer la référence', () => {
    const page = ['Les amplis pour ESP32', 'Comparatif', 'PAM8403 : un ampli analogique.', 'Le MAX98357A est un ampli I2S.', 'Il demande 5 V et donne 3 W par canal.'].join('\n');
    expect(verifierFait(page, 'MAX98357A', { fait: 'Il demande 5 V.', extrait: 'Il demande 5 V et donne 3 W par canal.' })).toBeNull();
    const loin = ['Les amplis', 'Pour ESP32', 'Comparatif', 'Le MAX98357A est un ampli I2S.', 'Autre', 'Autre encore', 'Le PAM8403 est analogique.', 'Il demande 5 V et donne 3 W par canal.'].join('\n');
    expect(verifierFait(loin, 'MAX98357A', { fait: 'Il demande 5 V.', extrait: 'Il demande 5 V et donne 3 W par canal.' })).toMatch(/ne parle pas/);
  });
  it('la référence se reconnaît sans tirets ni espaces', () => {
    expect(pageDeLaReference('ESP32 S3 WROOM 1 module', 'ESP32-S3-WROOM-1')).toBe(true);
    expect(pageDeLaReference('ESP32 module', 'ESP32-S3-WROOM-1')).toBe(false);
  });
});

describe('faits confirmés par deux sites', () => {
  it('même fait sur deux sites : deux sources ; deux pages du même site : une seule', () => {
    let faits: FaitVerifie[] = [];
    faits = ajouterFait(faits, 'MAX98357A', "S'alimente de 2,5 à 5,5 V", 'https://www.analog.com/a');
    faits = ajouterFait(faits, 'MAX98357A', 'Alimentation de 2.5 à 5.5 V', 'https://analog.com/b');
    expect(faits[0]!.sources).toHaveLength(1);
    faits = ajouterFait(faits, 'MAX98357A', 'Alimentation de 2.5 à 5.5 V', 'https://learn.adafruit.com/x');
    expect(faits).toHaveLength(1);
    expect(faits[0]!.sources).toHaveLength(2);
  });
  it('nombres différents : pas le même fait', () => {
    expect(memeFait('Alimentation 3,3 V', 'Alimentation 5 V')).toBe(false);
  });
  it('lit la liste de faits du modèle', () => {
    expect(lireReponseFaits('{"faits": [{"fait": "Ampli I2S", "extrait": "Class D amplifier"}, {"fait": "sans extrait"}]}')).toEqual([
      { fait: 'Ampli I2S', extrait: 'Class D amplifier' },
    ]);
  });
});

describe('recherche d’une référence', () => {
  it('lit les pages qui nomment la référence, une par site, et ne garde que les faits vérifiés', async () => {
    const pages: Record<string, string> = {
      'https://www.analog.com/max': PAGE_MAX,
      'https://www.analog.com/autre': PAGE_MAX,
      'https://exemple.fr/esp32': 'Guide des cartes ESP32 sans ampli.',
      'https://learn.adafruit.com/max': PAGE_MAX,
    };
    const lus: string[] = [];
    let t = 0;
    const r = await chercherReference(
      { reference: 'MAX98357A', question: "c'est quoi ?", fin: 1_000 },
      {
        chercher: async () => Object.keys(pages),
        lire: async (url) => {
          lus.push(url);
          return pages[url] ?? null;
        },
        modele: async () =>
          JSON.stringify({
            faits: [
              { fait: 'Alimentation de 2,5 à 5,5 V', extrait: 'It operates from a 2.5V to 5.5V supply and delivers 3.2W into a 4 ohm load at 5V.' },
              { fait: 'Puissance 20 W', extrait: 'It operates from a 2.5V to 5.5V supply' },
            ],
          }),
        maintenant: () => (t += 1),
      },
    );
    expect(r.pages).toEqual(['https://www.analog.com/max', 'https://learn.adafruit.com/max']);
    expect(lus).not.toContain('https://www.analog.com/autre');
    expect(r.faits).toHaveLength(1);
    expect(r.faits[0]!.sources).toEqual(['https://www.analog.com/max', 'https://learn.adafruit.com/max']);
  });
  it('recherche en panne : avertissement, aucun fait', async () => {
    const r = await chercherReference(
      { reference: 'INMP441', question: '?', fin: Number.MAX_SAFE_INTEGER },
      { chercher: async () => Promise.reject(new Error('hors ligne')), lire: async () => null, modele: async () => '' },
    );
    expect(r.faits).toEqual([]);
    expect(r.avertissements[0]).toMatch(/n'a pas abouti/);
  });
});

describe('réponse', () => {
  const vision = { description: 'Une carte bleue avec une puce.', texteLu: ['MAX98357A'], reponse: 'Un ampli I2S.', doutes: ['un peu floue'], brute: false };
  const recherches = [
    { reference: 'MAX98357A', pages: ['https://www.analog.com/max'], faits: [{ reference: 'MAX98357A', fait: 'Alimentation de 2,5 à 5,5 V', sources: ['https://www.analog.com/max'] }], avertissements: [] },
  ];
  it('la demande au modèle du chat dit d’où vient chaque chose', () => {
    const d = demandeReponseYeux({ question: "c'est quoi ?", vision, recherches });
    expect(d).toContain('Texte lu sur la photo : MAX98357A');
    expect(d).toContain("Alimentation de 2,5 à 5,5 V (d'après analog.com)");
  });
  it('sans modèle : la réponse des yeux et les faits sourcés seulement', () => {
    const r = reponseYeuxSansModele({ vision, recherches });
    expect(r).toContain('Un ampli I2S.');
    expect(r).toContain("MAX98357A : Alimentation de 2,5 à 5,5 V (d'après analog.com)");
    expect(r).toContain('Mes doutes : un peu floue.');
  });
  it('question électrique : rappel de sécurité ; sources et modèle cités à l’écrit', () => {
    expect(questionElectrique('mon câblage est bon ?')).toBe(true);
    expect(questionElectrique("c'est quoi ce composant ?")).toBe(false);
    const fin = finirReponseYeux({ texte: 'Ça ressemble à un ampli.', question: 'je peux le brancher en 5 V ?', recherches, modeleVision: 'gemma3:4b', oral: false });
    expect(fin).toContain(RAPPEL_SECURITE);
    expect(fin).toContain('- https://www.analog.com/max');
    expect(fin).toContain('gemma3:4b');
    const oral = finirReponseYeux({ texte: 'Un ampli.', question: 'mon câblage ?', recherches, modeleVision: 'gemma3:4b', oral: true });
    expect(oral).toBe(`Un ampli. ${RAPPEL_SECURITE}`);
  });
});
