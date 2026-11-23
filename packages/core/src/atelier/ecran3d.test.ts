import { describe, expect, it } from 'vitest';
import { fabriquer, gabarit } from './gabarits.js';
import {
  aretesOuvertes,
  controlerStl,
  ecrireStlBinaire,
  lireStl,
  maillageBoiteCreuse,
  maillageTube,
  tailleMaillage,
} from './stl.js';
import {
  cotes,
  grillePlateau,
  matriceVue,
  orbiteInitiale,
  placerSurPlateau,
  positionCamera,
  projeterEcran,
  tourner,
  zoomer,
} from './vue3d.js';

const triangle = [0, 0, 0, 10, 0, 0, 0, 10, 0];

describe('lecture d’un STL', () => {
  it('relit exactement un STL binaire écrit par Jarvis', () => {
    const maillage = lireStl(ecrireStlBinaire(maillageBoiteCreuse(80, 50, 30, 2, 2)));
    expect(maillage.triangles).toBe(5 * 2 + 5 * 2 + 8);
    expect(tailleMaillage(maillage)).toEqual([80, 50, 30]);
    expect(maillage.min).toEqual([0, 0, 0]);
  });

  it('lit un STL texte, comme celui qu’OpenSCAD écrit', () => {
    const texte = [
      'solid OpenSCAD_Model',
      '  facet normal 0 0 -1',
      '    outer loop',
      '      vertex 0 0 0',
      '      vertex 10 0 0',
      '      vertex 0 10 0',
      '    endloop',
      '  endfacet',
      'endsolid OpenSCAD_Model',
    ].join('\n');
    const maillage = lireStl(new TextEncoder().encode(texte));
    expect(maillage.triangles).toBe(1);
    expect(tailleMaillage(maillage)).toEqual([10, 10, 0]);
    // Normale recalculée à partir des sommets, pas recopiée du fichier.
    expect(Array.from(maillage.normales.slice(0, 3))).toEqual([0, 0, 1]);
  });

  it('un binaire dont l’en-tête commence par « solid » est quand même lu comme binaire', () => {
    const buf = ecrireStlBinaire(triangle);
    buf.set(new TextEncoder().encode('solid trompeur'), 0);
    expect(lireStl(buf).triangles).toBe(1);
  });

  it('refuse un fichier vide, coupé ou qui n’est pas un STL, avec une phrase en français', () => {
    expect(() => lireStl(new Uint8Array(0))).toThrow('vide');
    const coupe = ecrireStlBinaire([...triangle, ...triangle]).slice(0, 120);
    expect(() => lireStl(coupe)).toThrow('STL');
    expect(() => lireStl(new TextEncoder().encode('bonjour, ceci n’est pas une pièce'))).toThrow('STL');
  });
});

describe('contrôle de la pièce', () => {
  it('une boîte creuse bien formée est fermée et à la bonne taille', () => {
    const controle = controlerStl(lireStl(ecrireStlBinaire(maillageBoiteCreuse(80, 50, 30, 2, 2))), [80, 50, 30]);
    expect(controle).toMatchObject({ ok: true, fermee: true, aretesOuvertes: 0, problemes: [] });
  });

  it('un tube (entretoise) est fermé', () => {
    expect(aretesOuvertes(lireStl(ecrireStlBinaire(maillageTube(20, 8, 15))))).toBe(0);
  });

  it('une pièce trouée (un triangle en moins) est signalée', () => {
    const plein = maillageBoiteCreuse(40, 40, 20, 2, 2);
    const troue = plein.slice(0, plein.length - 9);
    const controle = controlerStl(lireStl(ecrireStlBinaire(troue)));
    expect(controle.fermee).toBe(false);
    expect(controle.problemes.join(' ')).toContain('pas fermée');
  });

  it('une taille différente de celle annoncée est dite, à 0,2 mm près', () => {
    const maillage = lireStl(ecrireStlBinaire(maillageBoiteCreuse(80, 50, 30, 2, 2)));
    expect(controlerStl(maillage, [80.1, 50, 30]).ok).toBe(true);
    const controle = controlerStl(maillage, [80, 50, 35]);
    expect(controle.ok).toBe(false);
    expect(controle.problemes[0]).toBe('hauteur : 30 mm au lieu de 35 mm.');
  });

  it('la taille du gabarit « boîte » est celle de l’aperçu de même mesure', () => {
    const piece = fabriquer(gabarit('boite')!, { longueur: 80, largeur: 50, hauteur: 30 });
    expect(piece.ok).toBe(true);
    if (!piece.ok) return;
    const maillage = lireStl(ecrireStlBinaire(maillageBoiteCreuse(80, 50, 30, 2, 2)));
    expect(controlerStl(maillage, piece.taille).ok).toBe(true);
  });
});

describe('vue 3D', () => {
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [80, 50, 30];

  it('la vue de départ vise le milieu de la pièce et la montre en entier', () => {
    const orbite = orbiteInitiale(min, max);
    expect(orbite.cible).toEqual([40, 25, 15]);
    const m = matriceVue(orbite, 800, 600);
    for (const coin of [min, max, [80, 0, 0], [0, 50, 30]] as [number, number, number][]) {
      const p = projeterEcran(m, coin, 800, 600)!;
      expect(p[0]).toBeGreaterThan(0);
      expect(p[0]).toBeLessThan(800);
      expect(p[1]).toBeGreaterThan(0);
      expect(p[1]).toBeLessThan(600);
    }
    const centre = projeterEcran(m, orbite.cible, 800, 600)!;
    expect(Math.round(centre[0])).toBe(400);
    expect(Math.round(centre[1])).toBe(300);
  });

  it('tourner garde la distance ; la caméra ne passe jamais par-dessus le sommet', () => {
    const depart = orbiteInitiale(min, max);
    const apres = tourner(depart, 300, 10_000);
    expect(apres.elevation).toBe(89);
    const a = positionCamera(depart);
    const b = positionCamera(apres);
    const distance = (p: number[]) => Math.hypot(p[0]! - 40, p[1]! - 25, p[2]! - 15);
    expect(distance(b)).toBeCloseTo(distance(a), 5);
  });

  it('le zoom reste entre 0,6 et 12 fois la taille de la pièce', () => {
    const depart = orbiteInitiale(min, max);
    expect(zoomer(depart, 0.0001).distance).toBeCloseTo(depart.rayon * 0.6);
    expect(zoomer(depart, 1e6).distance).toBeCloseTo(depart.rayon * 12);
  });

  it('pose la pièce au milieu du plateau, à plat', () => {
    expect(placerSurPlateau([10, 20, -5], [90, 70, 25], { x: 300, y: 300 })).toEqual([100, 105, 5]);
  });

  it('quadrille le plateau de l’Ender 3 S1 Plus tous les 10 mm', () => {
    const lignes = grillePlateau({ x: 300, y: 300 });
    expect(lignes.length / 6).toBe(31 * 2);
  });

  it('écrit les trois cotes en millimètres, à la française', () => {
    expect(cotes([0, 0, 0], [80, 50.25, 30]).map((cote) => `${cote.nom} ${cote.texte}`)).toEqual([
      'Longueur 80 mm',
      'Largeur 50,3 mm',
      'Hauteur 30 mm',
    ]);
  });

  it('un point derrière la caméra n’est pas dessiné', () => {
    const orbite = orbiteInitiale(min, max);
    const m = matriceVue(orbite, 800, 600);
    const oeil = positionCamera(orbite);
    const derriere: [number, number, number] = [oeil[0] * 3 - 80, oeil[1] * 3 - 50, oeil[2] * 3 - 30];
    expect(projeterEcran(m, derriere, 800, 600)).toBeNull();
  });
});
