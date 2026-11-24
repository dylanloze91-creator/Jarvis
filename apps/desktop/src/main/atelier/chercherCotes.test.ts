import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMessage, type ChatMessage } from '@jarvis/core';
import { chercherCotes, type DepsChercherCotes } from './chercherCotes.js';
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
    expect(r.produit?.manquants).toEqual(['hauteur_dessus']);
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
    expect(r.raison).toBe('Je n’ai trouvé aucune page lisible sur « carte inconnue ».'.replace('’', "'"));
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
    expect(r?.texte).toMatch(/^8 cotes sur 9 trouvées sur Internet pour « ESP32 DevKit essai »\./);
    expect(r?.texte).toMatch(/Internet ne m'a pas donné toutes les cotes\..*la hauteur du composant le plus haut/);
    expect(r?.etat).toMatchObject({ etape: 'mesure', champ: 'hauteur_dessus' });
    const fichier = JSON.parse(await readFile(join(racine, 'composants-cotes.json'), 'utf8'));
    expect(fichier.recherches[ESP]).toEqual({ produit: 'ESP32 DevKit essai', jour: '2026-11-25', manquants: ['hauteur_dessus'] });
    expect(fichier.cotes[ESP].longueur).toEqual([
      { valeur: 51, source: 'https://a.test/carte' },
      { valeur: 51, source: 'https://b.test/plan' },
    ]);
    // Une autre discussion : la recherche n'est pas refaite, seule la mesure qui manque est demandée.
    const autre: ChatMessage[] = [];
    expect((await dire(autre, 'Fais-moi un boîtier pour mon ESP32', d))?.etat).toMatchObject({ etape: 'mesure', champ: 'hauteur_dessus' });
  });
});
