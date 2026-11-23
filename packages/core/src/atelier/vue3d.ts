/**
 * Atelier 3D — calculs de la vue 3D (caméra qui tourne autour de la pièce, plateau, cotes).
 *
 * Pur : seulement des nombres. L'écran 3D (fenêtre de Jarvis) s'en sert pour dessiner avec WebGL,
 * sans bibliothèque. Repère d'OpenSCAD et de l'imprimante : millimètres, Z vers le haut.
 * Matrices en colonnes (comme WebGL).
 */
import type { Vec3 } from './stl.js';

export type Mat4 = Float32Array;

export function identite(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function multiplier(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let lig = 0; lig < 4; lig += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + lig]! * b[col * 4 + k]!;
      out[col * 4 + lig] = s;
    }
  }
  return out;
}

export function perspective(champDegres: number, rapport: number, pres: number, loin: number): Mat4 {
  const f = 1 / Math.tan((champDegres * Math.PI) / 360);
  const m = new Float32Array(16);
  m[0] = f / rapport;
  m[5] = f;
  m[10] = (loin + pres) / (pres - loin);
  m[11] = -1;
  m[14] = (2 * loin * pres) / (pres - loin);
  return m;
}

function normaliser(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function vectoriel(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function regarder(oeil: Vec3, cible: Vec3, haut: Vec3 = [0, 0, 1]): Mat4 {
  const z = normaliser([oeil[0] - cible[0], oeil[1] - cible[1], oeil[2] - cible[2]]);
  let x = vectoriel(haut, z);
  if (Math.hypot(...x) < 1e-6) x = vectoriel([0, 1, 0], z); // regard droit vers le haut ou le bas
  x = normaliser(x);
  const y = vectoriel(z, x);
  const m = identite();
  m[0] = x[0];
  m[4] = x[1];
  m[8] = x[2];
  m[1] = y[0];
  m[5] = y[1];
  m[9] = y[2];
  m[2] = z[0];
  m[6] = z[1];
  m[10] = z[2];
  m[12] = -(x[0] * oeil[0] + x[1] * oeil[1] + x[2] * oeil[2]);
  m[13] = -(y[0] * oeil[0] + y[1] * oeil[1] + y[2] * oeil[2]);
  m[14] = -(z[0] * oeil[0] + z[1] * oeil[1] + z[2] * oeil[2]);
  return m;
}

/** Champ de vision vertical de l'écran 3D (degrés). */
export const CHAMP_VUE = 40;
export const ELEVATION_MIN = -80;
export const ELEVATION_MAX = 89;

export interface Orbite {
  /** Angle autour de l'axe vertical (degrés). */
  azimut: number;
  /** Hauteur de la caméra (degrés, 0 = à l'horizontale). */
  elevation: number;
  distance: number;
  cible: Vec3;
  /** Rayon de la pièce : borne le zoom. */
  rayon: number;
}

/** Vue de départ : trois quarts, d'un peu au-dessus, toute la pièce dans l'écran. */
export function orbiteInitiale(min: Vec3, max: Vec3): Orbite {
  const cible: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const rayon = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  const distance = (rayon / Math.sin((CHAMP_VUE * Math.PI) / 360)) * 1.15;
  return { azimut: -55, elevation: 28, distance, cible, rayon };
}

/** Glisser horizontalement fait tourner, verticalement fait monter ou descendre la caméra. */
export function tourner(orbite: Orbite, dxPixels: number, dyPixels: number): Orbite {
  const elevation = Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, orbite.elevation + dyPixels * 0.4));
  let azimut = (orbite.azimut - dxPixels * 0.4) % 360;
  if (azimut < -180) azimut += 360;
  if (azimut > 180) azimut -= 360;
  return { ...orbite, azimut, elevation };
}

/** Facteur > 1 : on recule. Bornes : de 0,6 à 12 fois le rayon de la pièce. */
export function zoomer(orbite: Orbite, facteur: number): Orbite {
  const distance = Math.min(orbite.rayon * 12, Math.max(orbite.rayon * 0.6, orbite.distance * facteur));
  return { ...orbite, distance };
}

export function positionCamera(orbite: Orbite): Vec3 {
  const a = (orbite.azimut * Math.PI) / 180;
  const e = (orbite.elevation * Math.PI) / 180;
  return [
    orbite.cible[0] + orbite.distance * Math.cos(e) * Math.cos(a),
    orbite.cible[1] + orbite.distance * Math.cos(e) * Math.sin(a),
    orbite.cible[2] + orbite.distance * Math.sin(e),
  ];
}

/** Matrice complète (projection × vue) pour un écran de `largeur` × `hauteur` pixels. */
export function matriceVue(orbite: Orbite, largeur: number, hauteur: number): Mat4 {
  const pres = Math.max(0.1, orbite.distance - orbite.rayon * 3);
  const loin = orbite.distance + orbite.rayon * 40 + 400;
  return multiplier(perspective(CHAMP_VUE, largeur / Math.max(1, hauteur), pres, loin), regarder(positionCamera(orbite), orbite.cible));
}

/** Position à l'écran (pixels, origine en haut à gauche) d'un point 3D, ou `null` s'il est derrière. */
export function projeterEcran(m: Mat4, p: Vec3, largeur: number, hauteur: number): [number, number] | null {
  const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
  const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
  if (w <= 1e-6) return null;
  return [((x / w + 1) / 2) * largeur, ((1 - y / w) / 2) * hauteur];
}

/**
 * Décalage qui pose la pièce au milieu du plateau, à plat (son point le plus bas à z = 0),
 * comme le trancheur le fera.
 */
export function placerSurPlateau(min: Vec3, max: Vec3, plateau: { x: number; y: number }): Vec3 {
  return [plateau.x / 2 - (min[0] + max[0]) / 2, plateau.y / 2 - (min[1] + max[1]) / 2, -min[2]];
}

/** Lignes du quadrillage du plateau (2 points par ligne, 3 nombres par point), pas de `pas` mm. */
export function grillePlateau(plateau: { x: number; y: number }, pas = 10): Float32Array {
  const lignes: number[] = [];
  for (let x = 0; x <= plateau.x + 1e-6; x += pas) lignes.push(x, 0, 0, x, plateau.y, 0);
  for (let y = 0; y <= plateau.y + 1e-6; y += pas) lignes.push(0, y, 0, plateau.x, y, 0);
  return Float32Array.from(lignes);
}

export interface Cote {
  /** « Longueur », « Largeur », « Hauteur ». */
  nom: string;
  texte: string;
  /** Point 3D où écrire la cote (milieu d'une arête de la boîte qui entoure la pièce). */
  ancre: Vec3;
}

const mm = (x: number) => `${String(Math.round(x * 10) / 10).replace('.', ',')} mm`;

/**
 * Les trois cotes de la pièce, posées sur trois arêtes différentes de la boîte qui l'entoure
 * (longueur devant, largeur à droite, hauteur à gauche) pour qu'elles ne se chevauchent pas.
 */
export function cotes(min: Vec3, max: Vec3): Cote[] {
  return [
    { nom: 'Longueur', texte: mm(max[0] - min[0]), ancre: [(min[0] + max[0]) / 2, min[1], min[2]] },
    { nom: 'Largeur', texte: mm(max[1] - min[1]), ancre: [max[0], (min[1] + max[1]) / 2, min[2]] },
    { nom: 'Hauteur', texte: mm(max[2] - min[2]), ancre: [min[0], min[1], (min[2] + max[2]) / 2] },
  ];
}

/** Les 12 arêtes de la boîte qui entoure la pièce (pour la dessiner en traits fins). */
export function areteBoite(min: Vec3, max: Vec3): Float32Array {
  const [a, b, c] = min;
  const [d, e, f] = max;
  const p = [
    [a, b, c],
    [d, b, c],
    [d, e, c],
    [a, e, c],
    [a, b, f],
    [d, b, f],
    [d, e, f],
    [a, e, f],
  ];
  const paires = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const out: number[] = [];
  for (const [i, j] of paires) out.push(...p[i!]!, ...p[j!]!);
  return Float32Array.from(out);
}
