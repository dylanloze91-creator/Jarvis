/**
 * Le boîtier à écran côté PC, avec un faux OpenSCAD (un pavé aux cotes de chaque pièce) et des
 * contrôles fournis : la phrase de l'examen donne un ensemble de pièces, chacune avec son fichier,
 * le boîtier monté et éclaté, la fiche avec les contrôles ; il s'imprime pièce par pièce ; un
 * contrôle raté n'est jamais montré comme bon.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHOIX_HUB, dessinerBoitierEcran, ecrireStlBinaire, type AtelierEtat, type ChatMessage, type ControleBoitier } from '@jarvis/core';
import { tourAtelier, type AtelierDeps } from './tourAtelier.js';

const EXAMEN = 'Dessine-moi un boîtier pour un Raspberry Pi 5 avec l’écran tactile 7 pouces et la caméra grand angle, les ports à l’arrière';

/** Pavé plein fermé sur la boîte englobante de la pièce (x0, x1, y0, y1, z0, z1). */
function pave(a: readonly number[]): Uint8Array {
  const [x0, x1, y0, y1, z0, z1] = a as [number, number, number, number, number, number];
  const p = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
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
let tranches: string[];
let cartes: string[];

const tailles = new Map(
  dessinerBoitierEcran(CHOIX_HUB)
    .pieces()
    .map((p) => [p.nom, p.forme.geo!.aabb] as const),
);

function deps(controles: ControleBoitier[]): AtelierDeps {
  return {
    racine,
    jour: () => '2026-11-25',
    volume: async () => ({ x: 250, y: 250, z: 250 }),
    imprimante: () => null,
    mesures: { lire: async () => ({}), ecrire: async () => undefined },
    cotes: { lire: async () => ({}) },
    controlerBoitier: async (_b, avancement) => {
      avancement(0.5, 'collisions');
      return controles;
    },
    programmes: {
      openscad: () => 'openscad.com',
      rendreStl: async (_exe, _scad, stl, delai) => {
        rendus.push(basename(stl));
        expect(delai).toBeGreaterThan(180_000);
        const nom = /^v\d+-(.+)\.stl$/.exec(basename(stl))![1]!;
        await writeFile(stl, pave(tailles.get(nom)!));
        return { ok: true, message: 'Pièce dessinée.' };
      },
      rendreImage: async () => ({ ok: false }),
      trancher: async (stl) => {
        tranches.push(basename(stl));
        return { ok: false, message: 'OrcaSlicer absent (essai).', gcode: null, infos: null };
      },
    },
  };
}

const bons = (n = 64): ControleBoitier[] => Array.from({ length: n }, (_, i) => ({ groupe: 'essai', controle: `contrôle ${i + 1}`, ok: true, mesure: 'ok', attendu: '' }));

beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), 'jarvis-boitier-'));
  rendus = [];
  tranches = [];
  cartes = [];
});
afterEach(async () => {
  await rm(racine, { recursive: true, force: true });
});

async function examen(controles: ControleBoitier[]) {
  const messages: ChatMessage[] = [];
  const progres: string[] = [];
  const r = await tourAtelier({ text: EXAMEN, messages, place: 'fenetre', confirm: async (t) => (cartes.push(t), false), progress: (m) => progres.push(m) }, deps(controles));
  return { r, progres };
}

describe('boîtier à écran sur le PC', () => {
  it('la phrase de l’examen : 9 pièces rendues, le boîtier monté et éclaté, « 64 contrôles sur 64 »', async () => {
    const { r, progres } = await examen(bons());
    expect(r?.texte).toMatch(/Boîtier à écran de 202,5 × /);
    expect(r?.texte).toMatch(/64 contrôles sur 64/);
    expect(r?.texte).toMatch(/9 pièces à imprimer une par une \(12 en tout\)/);
    expect(r?.texte).toMatch(/imprime la façade/);
    expect(progres.some((m) => /Je vérifie le boîtier : collisions/.test(m))).toBe(true);
    expect(rendus).toHaveLength(9);
    expect(rendus[0]).toBe('v1-Socle.stl');
    const etat = r?.etat as Extract<AtelierEtat, { etape: 'piece' }>;
    expect(etat.gabarit).toBe('boitier_ecran');
    const v = etat.versions[0]!;
    expect(v.pieces?.map((p) => p.nom)).toContain('Facade');
    expect(v.controles).toEqual({ total: 64, ok: 64 });
    for (const f of ['v1.stl', 'v1-eclate.stl', 'v1.scad', 'v1-controles.txt', 'v1-Facade.scad']) expect(existsSync(join(racine, etat.dossier, f)), f).toBe(true);
  });

  it('s’imprime pièce par pièce : « imprime la façade » tranche la façade seule', async () => {
    const { r } = await examen(bons());
    const messages: ChatMessage[] = [{ role: 'assistant', content: r!.texte, atelier: r!.etat } as ChatMessage];
    const r2 = await tourAtelier({ text: 'imprime la façade', messages, place: 'fenetre', confirm: async () => false }, deps(bons()));
    expect(tranches).toEqual(['v1-Facade.stl']);
    expect(r2?.texte).toMatch(/OrcaSlicer absent/);
    const r3 = await tourAtelier({ text: 'imprime-la', messages, place: 'fenetre', confirm: async () => false }, deps(bons()));
    expect(r3?.texte).toMatch(/9 pièces à imprimer une par une/);
    expect(tranches).toHaveLength(1);
  });

  it('une nouvelle version reprend les pièces qui n’ont pas changé', async () => {
    const { r } = await examen(bons());
    rendus = [];
    const messages: ChatMessage[] = [{ role: 'assistant', content: r!.texte, atelier: r!.etat } as ChatMessage];
    const r2 = await tourAtelier({ text: 'sans cache', messages, place: 'fenetre', confirm: async () => false }, deps(bons(57)));
    expect(r2?.texte).toMatch(/Version 2 \(Cache de la caméra : oui → non\)/);
    // façade (fente du cache) redessinée ; socle, capot, dos, retenues, chariot repris
    expect(rendus).toEqual(['v2-Facade.stl']);
  });

  it('un contrôle raté : le boîtier n’est pas montré, la raison est dite', async () => {
    const controles = bons();
    controles[60] = { groupe: 'stabilité', controle: 'appui sur le haut de la zone tactile avant de basculer en arrière', ok: false, mesure: '2.1 N', attendu: '≥ 3 N' };
    const { r } = await examen(controles);
    expect(r?.texte).toMatch(/Je ne te montre pas ce boîtier : 63 contrôles sur 64/);
    expect(r?.texte).toMatch(/moins incliné/);
    expect(r?.etat).toBeUndefined();
  });
});
