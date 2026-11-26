import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMessage, type ChatMessage } from '@jarvis/core';
import { chercherCotes, type DepsChercherCotes, type PageLue } from './chercherCotes.js';
import { tourAtelier, type AtelierDeps } from './tourAtelier.js';

/**
 * Cotes cherchées sur Internet, avec un faux Internet et un faux modèle : les pages, les nombres et
 * les réponses sont inventés pour le test (aucune vraie cote de composant).
 */
const ESP = 'esp32_s3_devkitc_1_borniers';

const PAGES: Record<string, string> = {
  'https://a.test/carte': 'Fiche ESP32 DevKit essai\nBoard size: 51 x 28 mm\nPCB thickness 1.6 mm\nMounting hole diameter 3 mm',
  'https://b.test/plan': 'Plan de la ESP32-DevKit (essai)\nDimensions 51 mm x 28 mm\nHoles: 3 mm, spaced 46 x 23 mm\n4 holes, 2.5 mm from each edge',
  // Une autre carte : la page ne nomme pas le produit, elle ne sert pas.
  'https://c.test/forum': 'Les tailles des ESP32\nCette carte fait 55 mm de long et 30 mm de large',
};

/** Faux modèle : propose ce qu'on lui dit pour chaque page, dont une cote inventée à jeter. */
const PROPOSITIONS: Record<string, unknown[]> = {
  'https://a.test/carte': [
    { champ: 'longueur', valeur: 51, extrait: 'Board size: 51 x 28 mm' },
    { champ: 'largeur', valeur: 28, extrait: 'Board size: 51 x 28 mm' },
    { champ: 'epaisseur', valeur: 1.6, extrait: 'PCB thickness 1.6 mm' },
    { champ: 'trou_diametre', valeur: 3, extrait: 'Mounting hole diameter 3 mm' },
    // Inventée : l'extrait n'est pas dans la page.
    { champ: 'hauteur_dessus', valeur: 12, extrait: 'Height above board 12 mm' },
  ],
  'https://b.test/plan': [
    { champ: 'longueur', valeur: 51, extrait: 'Dimensions 51 mm x 28 mm' },
    { champ: 'largeur', valeur: 28, extrait: 'Dimensions 51 mm x 28 mm' },
    { champ: 'entraxe_x', valeur: 46, extrait: 'spaced 46 x 23 mm' },
    { champ: 'entraxe_y', valeur: 23, extrait: 'spaced 46 x 23 mm' },
    { champ: 'trou_bord_x', valeur: 2.5, extrait: '2.5 mm from each edge' },
    { champ: 'trou_bord_y', valeur: 2.5, extrait: '2.5 mm from each edge' },
  ],
  'https://c.test/forum': [{ champ: 'longueur', valeur: 55, extrait: 'Cette carte fait 55 mm de long' }],
};

function fauxInternet(journal: string[] = []): DepsChercherCotes {
  return {
    chercher: async (q) => {
      journal.push(`cherche ${q}`);
      return ['https://a.test/carte', 'https://b.test/plan', 'https://c.test/forum', 'https://a.test/plan.pdf'];
    },
    lire: async (url) => {
      journal.push(`lit ${url}`);
      return PAGES[url] ?? null;
    },
    modele: async (_s, demande) => {
      const url = /Page: (\S+)/.exec(demande)![1]!;
      return JSON.stringify({ cotes: PROPOSITIONS[url] ?? [] });
    },
  };
}

describe('chercherCotes (étape)', () => {
  it('lit les pages, vérifie chaque proposition, deux sites = sûr, une source = à vérifier, rien d’inventé', async () => {
    const journal: string[] = [];
    const etapes: string[] = [];
    const r = await chercherCotes({ composant: ESP, produit: 'ESP32 DevKit essai' }, fauxInternet(journal), (a) => etapes.push(a.etape));
    expect(r.ok).toBe(true);
    expect(r.produit?.manquants).toEqual(['hauteur_dessus', 'hauteur_dessous']);
    expect(r.produit?.cotes[ESP]?.hauteur_dessus).toBeUndefined();
    expect(r.sources.join('\n')).toMatch(/la longueur de la carte : 51 mm \(https:\/\/a\.test\/carte ; https:\/\/b\.test\/plan\)/);
    expect(r.incertitudes.join('\n')).toMatch(/l’épaisseur de la carte : 1,6 mm, une seule source \(https:\/\/a\.test\/carte\)/);
    expect(journal.some((l) => l.includes('.pdf'))).toBe(false);
    // La page sur « les tailles des ESP32 » a été lue mais pas retenue : 55 mm n'entre pas.
    expect(journal).toContain('lit https://c.test/forum');
    expect(r.produit?.pages).not.toContain('https://c.test/forum');
    expect(r.produit?.cotes[ESP]?.longueur?.map((l) => l.valeur)).toEqual([51, 51]);
    expect(etapes).toContain('recherche');
    expect(etapes.at(-1)).toBe('fin');
  });

  it('rien de lisible : pas ok, et dit pourquoi', async () => {
    const r = await chercherCotes({ composant: ESP, produit: 'carte inconnue' }, { ...fauxInternet(), lire: async () => null });
    expect(r.ok).toBe(false);
    expect(r.raison).toContain("Je n'ai rien pu lire sur Internet pour « carte inconnue »");
  });
});

describe('dans la discussion', () => {
  let racine: string;
  beforeEach(async () => {
    racine = await mkdtemp(join(tmpdir(), 'atelier-cotes-'));
  });
  afterEach(async () => {
    await rm(racine, { recursive: true, force: true });
  });

  function deps(): AtelierDeps {
    return {
      racine,
      jour: () => '2026-11-25',
      volume: async () => ({ x: 250, y: 250, z: 250 }),
      imprimante: () => null,
      programmes: { openscad: () => null, rendreStl: async () => ({ ok: false, message: '' }), rendreImage: async () => ({ ok: false }), trancher: async () => ({ ok: false, message: '', gcode: null, infos: null }) },
      chercherCotes: fauxInternet(),
    };
  }

  async function dire(messages: ChatMessage[], text: string, d: AtelierDeps) {
    const sortie = await tourAtelier({ text, messages, place: 'fenetre', confirm: async () => false }, d);
    messages.push(createMessage('user', text));
    if (sortie) messages.push({ ...createMessage('assistant', sortie.texte), ...(sortie.etat ? { atelier: sortie.etat } : {}) });
    return sortie;
  }

  it('« un boîtier pour mon ESP32 » → quel modèle ? → recherche, cotes gardées avec leurs sources, puis ce qui manque', async () => {
    const messages: ChatMessage[] = [];
    const d = deps();
    const q = await dire(messages, 'Fais-moi un boîtier pour mon ESP32', d);
    expect(q?.etat).toMatchObject({ etape: 'produit' });
    const progres: string[] = [];
    const r = await tourAtelier({ text: 'ESP32 DevKit essai', messages, place: 'fenetre', confirm: async () => false, progress: (m) => progres.push(m) }, d);
    expect(progres[0]).toBe('Je cherche les cotes de « ESP32 DevKit essai » sur Internet…');
    expect(r?.texte).toMatch(/^Sur Internet, pour « ESP32 DevKit essai », j'ai trouvé 3 des 5 cotes qu'il me faut\. Trous de fixation trouvés\./);
    expect(r?.texte).toMatch(/Internet ne m'a pas donné toutes les cotes\..*la hauteur du composant le plus haut/);
    expect(r?.etat).toMatchObject({ etape: 'mesure', champ: 'hauteur_dessus' });
    const fichier = JSON.parse(await readFile(join(racine, 'composants-cotes.json'), 'utf8'));
    expect(fichier.recherches[ESP]).toEqual({ produit: 'ESP32 DevKit essai', jour: '2026-11-25', manquants: ['hauteur_dessus', 'hauteur_dessous'] });
    expect(fichier.cotes[ESP].longueur).toEqual([
      { valeur: 51, source: 'https://a.test/carte' },
      { valeur: 51, source: 'https://b.test/plan' },
    ]);
    // Une autre discussion : la recherche n'est pas refaite, seule la mesure qui manque est demandée.
    const autre: ChatMessage[] = [];
    expect((await dire(autre, 'Fais-moi un boîtier pour mon ESP32', d))?.etat).toMatchObject({ etape: 'mesure', champ: 'hauteur_dessus' });
  });
});

// ---------------------------------------------------------------------------------------------
// Étape 3 (25 novembre) : les plans des fabricants, et l'examen à deux composants.

const EXAMEN = 'Dessine-moi un boîtier pour un ESP32-S3 DevKitC-1 avec un écran OLED 1,3 pouce I2C, prise USB à l’arrière';
const OLED = 'oled_1_3_sh1106';

/** Un plan DXF inventé : carte de 60 × 25, broches, une prise USB au bord x−, un module qui dépasse au bord x+. */
function planDxf(titre: string): string {
  const e: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES'];
  const rect = (calque: string, x0: number, y0: number, x1: number, y1: number) => e.push(0, 'LWPOLYLINE', 8, calque, 90, 4, 70, 1, 10, x0, 20, y0, 10, x1, 20, y0, 10, x1, 20, y1, 10, x0, 20, y1);
  rect('BOARD_OUTLINE', 0, 0, 60, 25);
  e.push(0, 'CIRCLE', 8, 'DRILLHOLE', 10, 5, 20, 1.27, 40, 0.5);
  rect('TOP_ASSY', -0.8, 9, 5, 16.5);
  e.push(0, 'TEXT', 8, 'SILK', 10, 2.5, 20, 12, 1, 'USB');
  rect('TOP_ASSY', 55, 4, 66, 21);
  e.push(0, 'TEXT', 8, 'TITLE', 10, 0, 20, -10, 1, titre, 0, 'ENDSEC', 0, 'EOF');
  return e.join('\n');
}

function fauxInternetExamen(journal: string[] = []): DepsChercherCotes {
  const pages: Record<string, string | PageLue> = {
    'https://fab.test/guide': {
      texte: 'ESP32-S3-DevKitC-1 user guide\nThe board has two USB ports.',
      liens: [
        { url: 'https://fab.test/dl/DXF_ESP32-S3-DevKitC-1.dxf', texte: 'DXF' },
        { url: 'https://fab.test/dl/dimensions.pdf', texte: 'Dimensions (PDF)' },
        { url: 'https://fab.test/dl/catalogue.pdf', texte: 'Catalogue' },
      ],
    },
    'https://blog.test/esp': 'ESP32-S3-DevKitC-1 review\nPCB thickness 1.6 mm\nHeader pins pitch 2.54 mm',
    'https://shop.test/oled': '1.3 inch OLED display module I2C\nOutline Dimension 33.5 x 35.4 mm',
    'https://wiki.test/oled': '1.3" OLED I2C module\nPCB size: 35.4 x 33.5 mm\nPCB thickness 1.2 mm',
  };
  const propositions: Record<string, unknown[]> = {
    'https://blog.test/esp': [
      { champ: 'epaisseur', valeur: 1.6, extrait: 'PCB thickness 1.6 mm' },
      // Le pas des broches pris pour un trou : écarté, le plan dit qu'il n'y a aucun trou de fixation.
      { champ: 'trou_diametre', valeur: 2.54, extrait: 'Header pins pitch 2.54 mm' },
    ],
    // Longueur et largeur lues à l'envers : remises dans l'ordre.
    'https://shop.test/oled': [
      { champ: 'longueur', valeur: 33.5, extrait: 'Outline Dimension 33.5 x 35.4 mm' },
      { champ: 'largeur', valeur: 35.4, extrait: 'Outline Dimension 33.5 x 35.4 mm' },
    ],
    'https://wiki.test/oled': [
      { champ: 'longueur', valeur: 35.4, extrait: 'PCB size: 35.4 x 33.5 mm' },
      { champ: 'largeur', valeur: 33.5, extrait: 'PCB size: 35.4 x 33.5 mm' },
      { champ: 'epaisseur', valeur: 1.2, extrait: 'PCB thickness 1.2 mm' },
    ],
  };
  return {
    chercher: async (q) => {
      journal.push(`cherche ${q}`);
      return /oled/i.test(q) ? ['https://shop.test/oled', 'https://wiki.test/oled'] : ['https://fab.test/guide', 'https://blog.test/esp'];
    },
    lire: async (url) => {
      journal.push(`lit ${url}`);
      return pages[url] ?? null;
    },
    lirePlan: async (url) => {
      journal.push(`plan ${url}`);
      if (url.endsWith('DXF_ESP32-S3-DevKitC-1.dxf')) return { genre: 'dxf', texte: planDxf('ESP32-S3-DevKitC-1 Rev 1.1') };
      if (url.endsWith('dimensions.pdf')) return { genre: 'pdf', texte: '' };
      return null;
    },
    modele: async (_s, demande) => {
      const url = /Page: (\S+)/.exec(demande)![1]!;
      return JSON.stringify({ cotes: propositions[url] ?? [] });
    },
  };
}

describe('plans des fabricants, pendant la recherche', () => {
  it('le DXF lié depuis la page du fabricant est lu : cotes sûres, aucun trou, prise ; un PDF dessiné est dit', async () => {
    const journal: string[] = [];
    const r = await chercherCotes({ composant: ESP, produit: 'ESP32-S3 DevKitC-1' }, fauxInternetExamen(journal));
    expect(journal).toContain('plan https://fab.test/dl/DXF_ESP32-S3-DevKitC-1.dxf');
    // Le PDF de cotes est essayé (et son DXF du même nom) ; le catalogue n'a pas l'air d'un plan.
    expect(journal).toContain('plan https://fab.test/dl/dimensions.pdf');
    expect(journal).toContain('plan https://fab.test/dl/dimensions.dxf');
    expect(journal.some((l) => l.includes('catalogue'))).toBe(false);
    const cotes = r.produit!.cotes[ESP]!;
    expect(cotes.longueur).toEqual([{ valeur: 60, source: 'https://fab.test/dl/DXF_ESP32-S3-DevKitC-1.dxf', plan: true }]);
    expect(cotes.sans_trous?.[0]).toMatchObject({ valeur: 1, plan: true });
    expect(cotes.prise_bord?.[0]?.valeur).toBe(2);
    expect(cotes.trou_diametre).toBeUndefined();
    expect(r.produit!.manquants).toEqual(['hauteur_dessus', 'hauteur_dessous']);
    expect(r.raison).toBe('Sur Internet, pour « ESP32-S3 DevKitC-1 », j\'ai trouvé 3 des 5 cotes qu\'il me faut. Le plan du fabricant ne montre aucun trou de fixation.');
    expect(r.produit!.plans).toEqual([{ url: 'https://fab.test/dl/DXF_ESP32-S3-DevKitC-1.dxf', resume: 'carte de 60 × 25 mm, aucun trou de fixation, 1 prise (USB), un module qui dépasse du bord' }]);
    expect(r.avertissements.join(' ')).toMatch(/dimensions\.pdf est un dessin sans texte : je ne sais pas en lire les cotes/);
  });

  it('un plan qui ne nomme pas le produit (ni dans son cartouche, ni dans son adresse) ne sert pas', async () => {
    const deps = fauxInternetExamen();
    const r = await chercherCotes(
      { composant: ESP, produit: 'ESP32-S3 DevKitC-1' },
      {
        ...deps,
        lire: async (url) => (url === 'https://fab.test/guide' ? { texte: 'ESP32-S3-DevKitC-1 user guide', liens: [{ url: 'https://fab.test/dl/plan-carte.dxf', texte: 'Plan' }] } : deps.lire(url)),
        lirePlan: async (url) => (url.endsWith('.dxf') ? { genre: 'dxf', texte: planDxf('ARDUINO NANO') } : null),
      },
    );
    expect(r.produit!.cotes[ESP]?.longueur).toBeUndefined();
    expect(r.avertissements.join(' ')).toMatch(/ne nomme pas « ESP32-S3 DevKitC-1 » : je ne m'en sers pas/);
  });
});

describe('l’examen, avec un faux Internet', () => {
  let racine: string;
  beforeEach(async () => {
    racine = await mkdtemp(join(tmpdir(), 'atelier-examen-'));
  });
  afterEach(async () => {
    await rm(racine, { recursive: true, force: true });
  });

  it('cherche seul les deux composants, demande seulement ce qui manque, « prends large partout », puis la boîte', async () => {
    const d: AtelierDeps = {
      racine,
      jour: () => '2026-11-25',
      volume: async () => ({ x: 250, y: 250, z: 250 }),
      imprimante: () => null,
      programmes: { openscad: () => null, rendreStl: async () => ({ ok: false, message: '' }), rendreImage: async () => ({ ok: false }), trancher: async () => ({ ok: false, message: '', gcode: null, infos: null }) },
      chercherCotes: fauxInternetExamen(),
    };
    const messages: ChatMessage[] = [];
    const progres: string[] = [];
    const dire = async (text: string) => {
      const sortie = await tourAtelier({ text, messages, place: 'telephone', confirm: async () => false, progress: (m) => progres.push(m) }, d);
      messages.push(createMessage('user', text));
      if (sortie) messages.push({ ...createMessage('assistant', sortie.texte), ...(sortie.etat ? { atelier: sortie.etat } : {}) });
      return sortie;
    };
    const q = await dire(EXAMEN);
    expect(progres).toContain('Je cherche les cotes de « ESP32-S3 DevKitC-1 » sur Internet…');
    expect(progres).toContain('Je cherche les cotes de « écran OLED 1,3 pouce I2C » sur Internet…');
    expect(q?.texte).toMatch(/^Sur Internet, pour « ESP32-S3 DevKitC-1 », j'ai trouvé 3 des 5 cotes qu'il me faut\. Le plan du fabricant ne montre aucun trou de fixation\. Plan du fabricant \(fab\.test\) : carte de 60 × 25 mm/);
    expect(q?.texte).toMatch(/Sur Internet, pour « écran OLED 1,3 pouce I2C », j'ai trouvé 3 des 9 cotes qu'il me faut\. Trous de fixation pas trouvés : il sera calé dans un cadre\./);
    // Pas d'adresse complète dans la discussion : le site seulement.
    expect(q?.texte).not.toMatch(/https?:\/\//);
    expect(q?.etat).toMatchObject({ etape: 'mesure', composant: ESP, champ: 'hauteur_dessus' });
    const fichier = JSON.parse(await readFile(join(racine, 'composants-cotes.json'), 'utf8'));
    expect(fichier.recherches[OLED]).toMatchObject({ produit: 'écran OLED 1,3 pouce I2C', plans: true });
    // La longueur de l'écran : deux sites d'accord une fois l'ordre remis.
    expect(fichier.cotes[OLED].longueur.map((l: { valeur: number }) => l.valeur)).toEqual([35.4, 35.4]);

    const p = await dire('prends large partout');
    expect(p?.texte).toMatch(/^D'accord, je prends large pour les 8 cotes qui manquaient, sans savoir si c'est juste/);
    expect(p?.texte).toMatch(/Boîte avec couvercle avec le ESP32-S3 DevKitC-1 dans ses glissières, prises vers l’arrière, l’écran OLED 1,3 pouce I2C sous le couvercle, derrière une fenêtre : je propose \d+ × \d+ × \d+ mm/);
    expect(p?.etat).toMatchObject({ etape: 'proposition', gabarit: 'boite_couvercle' });
    // Les valeurs larges sont gardées comme telles, jamais comme des mesures de l'utilisateur.
    const apres = JSON.parse(await readFile(join(racine, 'composants-cotes.json'), 'utf8'));
    expect(apres.cotes[ESP].hauteur_dessus).toEqual([{ valeur: 15, source: 'valeur large choisie par l’utilisateur, sans la pièce', choisie: true }]);
    await expect(readFile(join(racine, 'composants-mesures.json'), 'utf8')).rejects.toThrow();
  });

  it('d’anciennes mesures sans référence qui contredisent le plan : mises de côté (gardées), et c’est dit', async () => {
    await writeFile(join(racine, 'composants-mesures.json'), JSON.stringify({ version: 1, composants: { [ESP]: { longueur: 73, largeur: 83, epaisseur: 1.6 } } }), 'utf8');
    const d: AtelierDeps = {
      racine,
      jour: () => '2026-11-25',
      volume: async () => ({ x: 250, y: 250, z: 250 }),
      imprimante: () => null,
      programmes: { openscad: () => null, rendreStl: async () => ({ ok: false, message: '' }), rendreImage: async () => ({ ok: false }), trancher: async () => ({ ok: false, message: '', gcode: null, infos: null }) },
      chercherCotes: fauxInternetExamen(),
    };
    const r = await tourAtelier({ text: EXAMEN, messages: [], place: 'fenetre', confirm: async () => false }, d);
    expect(r?.texte).toMatch(/J'ai mis de côté tes anciennes mesures \(73 mm, 83 mm\) : elles ne collent pas avec « ESP32-S3 DevKitC-1 » \(60 mm, 25 mm\)/);
    const fichier = JSON.parse(await readFile(join(racine, 'composants-mesures.json'), 'utf8'));
    // L'épaisseur, qui ne contredit rien, reste ; les deux autres sont gardées à part.
    expect(fichier.composants[ESP]).toEqual({ epaisseur: 1.6 });
    expect(fichier.mises_de_cote[ESP]).toEqual([{ champs: { longueur: 73, largeur: 83 }, raison: 'contredites par les cotes sûres de « ESP32-S3 DevKitC-1 » (2026-11-25)' }]);
  });
});
