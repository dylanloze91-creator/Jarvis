import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ecrireStlBinaire, type Avancement } from '@jarvis/core';
import { ATELIER_SANS_OPENSCAD, fabriquerVersion } from './etapes.js';
import type { AtelierDeps } from './tourAtelier.js';

/**
 * L'étape « faire une version » appelée sans phrase ni fenêtre (cap « chef de projet », § 5) :
 * résultat honnête (fichiers, sources, incertitudes, avertissements), avancement, question rendue au
 * lieu d'attendre, et reprise d'un rendu identique sans relancer OpenSCAD.
 */
function pave(L: number, W: number, H: number): Uint8Array {
  const p = [
    [0, 0, 0], [L, 0, 0], [L, W, 0], [0, W, 0],
    [0, 0, H], [L, 0, H], [L, W, H], [0, W, H],
  ] as const;
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  return ecrireStlBinaire(faces.flatMap((f) => f.flatMap((i) => [...p[i]!])));
}

let racine: string;
let rendus: string[];
let vues: number[];

function deps(extra: { openscad?: string | null; fausseTaille?: boolean } = {}): Pick<AtelierDeps, 'racine' | 'programmes' | 'volume' | 'jour'> {
  return {
    racine,
    jour: () => '2026-11-24',
    volume: async () => ({ x: 300, y: 300, z: 300 }),
    programmes: {
      openscad: () => (extra.openscad === undefined ? 'openscad.com' : extra.openscad),
      rendreStl: async (_exe, scad, stl) => {
        rendus.push(stl);
        const m = /cube\(\[([\d.]+), ([\d.]+), ([\d.]+)\]\)/.exec(await readFile(scad, 'utf8'))!;
        const L = Number(m[1]) + (extra.fausseTaille ? 7 : 0);
        await writeFile(stl, pave(L, Number(m[2]), Number(m[3])));
        return { ok: true, message: 'Pièce dessinée.' };
      },
      rendreImage: async () => ({ ok: false }),
      rendreVues: async (_exe, dossier, numero) => {
        vues.push(numero);
        await writeFile(join(dossier, `v${numero}.png`), 'png');
        await writeFile(join(dossier, `v${numero}-dessus.png`), 'png');
        return { troisQuarts: `v${numero}.png`, dessus: `v${numero}-dessus.png` };
      },
      trancher: async () => ({ ok: false, message: 'pas ici', gcode: null, infos: null }),
    },
  };
}

const PI = JSON.stringify([{ genre: 'composant', composant: 'raspberry_pi_5', ports: 'arriere' }]);

beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), 'jarvis-etapes-'));
  rendus = [];
  vues = [];
});
afterEach(async () => {
  await rm(racine, { recursive: true, force: true });
});

describe('étape « faire une version »', () => {
  it('pièce réussie : fichiers, sources et incertitudes des composants, avancement dans l’ordre', async () => {
    const avancement: Avancement[] = [];
    const r = await fabriquerVersion({ gabarit: 'boite', valeurs: { longueur: 120, largeur: 100, hauteur: 40, ajouts: PI } }, deps(), (a) => avancement.push(a));
    expect(r.ok).toBe(true);
    expect(r.raison).toBeUndefined();
    expect(r.produit?.etat).toMatchObject({ etape: 'piece', gabarit: 'boite', dossier: 'boite-2026-11-24-1', versionChoisie: 1 });
    expect(r.produit?.version).toMatchObject({ numero: 1, image: 'v1.png', imageDessus: 'v1-dessus.png' });
    expect(r.fichiers.map((f) => f.slice(racine.length + 1).replaceAll('\\', '/'))).toEqual([
      'boite-2026-11-24-1/v1.scad', 'boite-2026-11-24-1/v1.stl', 'boite-2026-11-24-1/v1.png', 'boite-2026-11-24-1/v1-dessus.png',
    ]);
    for (const f of r.fichiers) expect(existsSync(f)).toBe(true);
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.sources.every((s) => s.startsWith('Raspberry Pi 5 : '))).toBe(true);
    expect(r.incertitudes.some((i) => /Ventilateur officiel \(incertain\)/.test(i))).toBe(true);
    expect(r.questions).toEqual([]);
    expect(avancement.map((a) => a.etape)).toEqual(['dessin', 'controle', 'images', 'fini']);
    expect(avancement.at(-1)).toMatchObject({ message: 'La pièce est prête.', part: 1 });
  });

  it('la carte ne tient pas : une question et les cotes qui tiennent, rien d’écrit', async () => {
    const r = await fabriquerVersion({ gabarit: 'boite', valeurs: { longueur: 120, largeur: 80, hauteur: 40, ajouts: PI } }, deps());
    expect(r.ok).toBe(false);
    expect(r.raison).toMatch(/ne tient pas dans le fond/);
    expect(r.questions).toEqual([{ id: 'agrandir', texte: 'Je l’agrandis à 120 × 94 × 40 mm ?'.replace('’', "'"), reponses: ['oui', 'non'] }]);
    expect(r.produit?.proposition).toMatchObject({ cotes: '120 × 94 × 40 mm', valeurs: { largeur: 94 } });
    expect(r.fichiers).toEqual([]);
    expect(rendus).toEqual([]);
  });

  it('reprise : la même pièce redemandée reprend le dessin et les images, sans OpenSCAD', async () => {
    const v1 = await fabriquerVersion({ gabarit: 'boite', valeurs: { longueur: 80, largeur: 50, hauteur: 30 } }, deps());
    const base = v1.produit!.etat!;
    const v2 = await fabriquerVersion({ gabarit: 'boite', valeurs: { longueur: 80, largeur: 50, hauteur: 30 }, base, changement: 'aucun' }, deps());
    expect(v2.ok).toBe(true);
    expect(v2.produit?.version).toMatchObject({ numero: 2, image: 'v2.png', imageDessus: 'v2-dessus.png' });
    expect(v2.repris).toEqual(['v1.stl', 'v1.png', 'v1-dessus.png']);
    expect(rendus).toHaveLength(1);
    expect(vues).toEqual([1]);
    expect(existsSync(join(racine, 'boite-2026-11-24-1', 'v2.stl'))).toBe(true);
  });

  it('contrôle raté : pas « ok », la raison est dite, la pièce reste produite pour la voir', async () => {
    const r = await fabriquerVersion({ gabarit: 'boite', valeurs: { longueur: 80, largeur: 50, hauteur: 30 } }, deps({ fausseTaille: true }));
    expect(r.ok).toBe(false);
    expect(r.raison).toBeTruthy();
    expect(r.produit?.etat?.etape).toBe('piece');
  });

  it('sans OpenSCAD : dit, rien inventé', async () => {
    const r = await fabriquerVersion({ gabarit: 'boite', valeurs: { longueur: 80, largeur: 50, hauteur: 30 } }, deps({ openscad: null }));
    expect(r).toMatchObject({ ok: false, raison: ATELIER_SANS_OPENSCAD, fichiers: [] });
  });

  it('pièce inconnue : dit', async () => {
    const r = await fabriquerVersion({ gabarit: 'fusee', valeurs: {} }, deps());
    expect(r).toMatchObject({ ok: false, raison: 'Je ne connais pas la pièce « fusee ».' });
  });
});
