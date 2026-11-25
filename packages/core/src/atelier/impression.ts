/**
 * Atelier 3D : une pièce s'imprime-t-elle sans support, posée telle quelle sur le plateau ?
 *
 * Deux contrôles, sur le STL rendu (même méthode que `reference/sources/imprim_hub.py` de la
 * mission des boîtiers, refaite ici sans bibliothèque) :
 *
 * - **Surplomb de plus de 45°** : les faces tournées vers le bas, plus couchées que 45° (avec une
 *   petite marge pour les chanfreins à 45° pile), au-dessus du plateau, regroupées en zones. Une
 *   zone basse et courte (bord évasé, haut d'un petit trou rond) s'imprime ; une zone qui monte
 *   d'au moins `SURPLOMB_HAUTEUR_MIN` sur au moins `SURPLOMB_AIRE_MIN` est un défaut.
 * - **Pont de plus de 25 mm** : la pièce est découpée en cubes de `pas` mm (0,5 mm, ou plus pour
 *   une très grande pièce). Dans chaque couche, les cubes qui n'ont rien sous eux, ni juste à côté
 *   en dessous (au-delà de 45°), forment des zones en l'air. Pour chaque zone, on cherche le point
 *   le plus loin de tout appui : tenu des deux côtés, c'est un pont, et sa portée est la somme des
 *   deux distances ; tenu d'un seul côté, c'est un porte-à-faux (un surplomb à plat).
 *
 * Pur : aucune dépendance, aucun accès disque. Unités : mm, dans le repère du STL (z vers le haut,
 * plateau en z = min).
 */
import type { Maillage } from './stl.js';

/** Portée la plus longue d'un pont imprimé sans support (règles de dessin de la mission). */
export const PONT_MAX_MM = 25;
/** Angle de surplomb le plus couché accepté (degrés depuis la verticale). */
export const SURPLOMB_MAX_DEG = 45;
/** Marge sur l'angle : un chanfrein dessiné à 45° pile reste accepté. */
const MARGE_DEG = 3;
/** Une zone de surplomb plus basse que ça (bord évasé, haut d'un trou) s'imprime. */
export const SURPLOMB_HAUTEUR_MIN = 3;
/** … et plus petite que ça aussi (haut d'un trou rond de 60 mm et moins). */
export const SURPLOMB_AIRE_MIN = 100;
/** Porte-à-faux à plat accepté (une marche de lamage, un rebord de 1,5 mm sans chanfrein). */
export const PORTE_A_FAUX_MAX = 4;
/** Les zones en l'air plus petites que ça ne comptent pas (bavure du découpage en cubes). */
const AIRE_COUCHE_MIN = 4;
/** Nombre de cubes au plus pour le découpage (mémoire). */
const CELLULES_MAX = 60_000_000;

export interface ZoneImpression {
  genre: 'pont' | 'surplomb' | 'porte-a-faux';
  /** Pont : portée. Porte-à-faux : avancée. Surplomb : hauteur de la zone. (mm) */
  mm: number;
  /** Surface de la zone (mm²). */
  aire: number;
  /** Hauteur au-dessus du plateau (mm) : bas de la zone. */
  z: number;
  /** Centre de la zone, vu de dessus (mm, repère du STL). */
  x: number;
  y: number;
}

export interface ControleImpression {
  ok: boolean;
  /** Phrases simples, avec le nom de la pièce et l'endroit. Vide si tout va bien. */
  problemes: string[];
  /** Les ponts, même acceptés (le plus long d'abord), pour le rapport. */
  ponts: ZoneImpression[];
  /** Les défauts : ponts trop longs, surplombs, porte-à-faux. */
  defauts: ZoneImpression[];
  /** Pas du découpage en cubes (mm). */
  pas: number;
}

const fmt = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');

// ---------------------------------------------------------------------------------------------
// Découpage en cubes

interface Grille {
  pas: number;
  nx: number;
  ny: number;
  nz: number;
  x0: number;
  y0: number;
  z0: number;
  plein: Uint8Array;
}

/**
 * Découpe la pièce en cubes : une verticale par colonne, et l'intérieur entre deux traversées
 * successives (règle pair-impair, valable pour un STL fermé).
 */
export function decouperEnCubes(maillage: Maillage, pasMin = 0.5): Grille {
  const [x0, y0, z0] = maillage.min;
  const [x1, y1, z1] = maillage.max;
  const volume = Math.max(1e-9, (x1 - x0) * (y1 - y0) * (z1 - z0));
  const pas = Math.max(pasMin, Math.cbrt(volume / CELLULES_MAX));
  const nx = Math.max(1, Math.ceil((x1 - x0) / pas));
  const ny = Math.max(1, Math.ceil((y1 - y0) / pas));
  const nz = Math.max(1, Math.ceil((z1 - z0) / pas));
  const plein = new Uint8Array(nx * ny * nz);

  // Traversées de chaque colonne, rangées par colonne (une verticale décalée d'un rien du centre,
  // pour ne jamais passer pile sur une arête).
  const dx = 0.5 + 1.3e-4;
  const dy = 0.5 + 2.9e-4;
  const traversees: number[][] = Array.from({ length: nx * ny }, () => []);
  const p = maillage.positions;
  for (let t = 0; t < maillage.triangles; t += 1) {
    const o = t * 9;
    const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!;
    const bx = p[o + 3]!, by = p[o + 4]!, bz = p[o + 5]!;
    const cx = p[o + 6]!, cy = p[o + 7]!, cz = p[o + 8]!;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue; // triangle vertical : aucune verticale ne le traverse
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / pas - dx));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / pas - dx));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / pas - dy));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - y0) / pas - dy));
    for (let i = i0; i <= i1; i += 1) {
      const x = x0 + (i + dx) * pas;
      for (let j = j0; j <= j1; j += 1) {
        const y = y0 + (j + dy) * pas;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        traversees[i * ny + j]!.push(l1 * az + l2 * bz + l3 * cz);
      }
    }
  }
  for (let c = 0; c < nx * ny; c += 1) {
    const zs = traversees[c]!;
    if (zs.length < 2) continue;
    zs.sort((a, b) => a - b);
    const base = c * nz;
    for (let q = 0; q + 1 < zs.length; q += 2) {
      const k0 = Math.max(0, Math.ceil((zs[q]! - z0) / pas - 0.5));
      const k1 = Math.min(nz - 1, Math.floor((zs[q + 1]! - z0) / pas - 0.5));
      for (let k = k0; k <= k1; k += 1) plein[base + k] = 1;
    }
  }
  return { pas, nx, ny, nz, x0, y0, z0, plein };
}

// ---------------------------------------------------------------------------------------------
// Ponts et porte-à-faux, couche par couche

function zonesEnLAir(g: Grille): ZoneImpression[] {
  const { nx, ny, nz, plein, pas } = g;
  const idx = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
  const zones: ZoneImpression[] = [];
  const enLAir = new Uint8Array(nx * ny);
  const vu = new Int32Array(nx * ny);
  const prise = new Int32Array(nx * ny);
  const source = new Int32Array(nx * ny);
  const dist = new Float64Array(nx * ny);
  let marque = 0;

  for (let k = 1; k < nz; k += 1) {
    enLAir.fill(0);
    let combien = 0;
    for (let i = 0; i < nx; i += 1) {
      for (let j = 0; j < ny; j += 1) {
        if (!plein[idx(i, j, k)] || plein[idx(i, j, k - 1)]) continue;
        let tenu = false;
        for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1) && !tenu; a += 1) {
          for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b += 1) {
            if (plein[idx(a, b, k - 1)]) {
              tenu = true;
              break;
            }
          }
        }
        if (!tenu) {
          enLAir[i * ny + j] = 1;
          combien += 1;
        }
      }
    }
    if (!combien) continue;

    // Zones (voisinage de 8) et distance à l'appui le plus proche (propagation de la source).
    for (let i = 0; i < nx; i += 1) {
      for (let j = 0; j < ny; j += 1) {
        const c0 = i * ny + j;
        if (!enLAir[c0] || prise[c0] === k) continue;
        marque += 1;
        const zone: number[] = [];
        const pile = [c0];
        vu[c0] = marque;
        while (pile.length) {
          const c = pile.pop()!;
          zone.push(c);
          prise[c] = k;
          const ci = Math.floor(c / ny);
          const cj = c % ny;
          for (let a = ci - 1; a <= ci + 1; a += 1) {
            for (let b = cj - 1; b <= cj + 1; b += 1) {
              if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
              const n = a * ny + b;
              if (enLAir[n] && vu[n] !== marque) {
                vu[n] = marque;
                pile.push(n);
              }
            }
          }
        }
        const aire = zone.length * pas * pas;
        if (aire < AIRE_COUCHE_MIN) continue;

        // Les appuis : cubes pleins de la même couche, tenus, qui touchent la zone.
        const appuis = new Set<number>();
        let file: number[] = [];
        for (const c of zone) {
          dist[c] = Number.POSITIVE_INFINITY;
          source[c] = -1;
        }
        for (const c of zone) {
          const ci = Math.floor(c / ny);
          const cj = c % ny;
          for (let a = ci - 1; a <= ci + 1; a += 1) {
            for (let b = cj - 1; b <= cj + 1; b += 1) {
              if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
              const n = a * ny + b;
              if (enLAir[n] || !plein[idx(a, b, k)]) continue;
              appuis.add(n);
              const d = Math.hypot(a - ci, b - cj);
              if (d < dist[c]!) {
                dist[c] = d;
                source[c] = n;
              }
            }
          }
          if (source[c]! >= 0) file.push(c);
        }
        // Propagation de proche en proche (distance euclidienne à la source retenue).
        while (file.length) {
          const suivante: number[] = [];
          for (const c of file) {
            const ci = Math.floor(c / ny);
            const cj = c % ny;
            const s = source[c]!;
            for (let a = ci - 1; a <= ci + 1; a += 1) {
              for (let b = cj - 1; b <= cj + 1; b += 1) {
                if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
                const n = a * ny + b;
                if (!enLAir[n] || vu[n] !== marque) continue;
                const d = Math.hypot(a - Math.floor(s / ny), b - (s % ny));
                if (d + 1e-9 < dist[n]!) {
                  dist[n] = d;
                  source[n] = s;
                  suivante.push(n);
                }
              }
            }
          }
          file = suivante;
        }

        let loin = -1;
        let dmax = -1;
        let sx = 0;
        let sy = 0;
        for (const c of zone) {
          sx += Math.floor(c / ny);
          sy += c % ny;
          const d = dist[c]!;
          if (d > dmax) {
            dmax = d;
            loin = c;
          }
        }
        const x = g.x0 + (sx / zone.length + 0.5) * pas;
        const y = g.y0 + (sy / zone.length + 0.5) * pas;
        const z = g.z0 + k * pas;
        if (!appuis.size || !Number.isFinite(dmax)) {
          // Rien ne la tient dans la couche : une île en l'air (pont sans appui).
          const etendue = Math.sqrt(zone.length) * pas;
          zones.push({ genre: 'porte-a-faux', mm: etendue, aire, z, x, y });
          continue;
        }
        // Tenue des deux côtés ? Un autre appui dans la direction opposée (à plus de 120°).
        const pi = Math.floor(loin / ny);
        const pj = loin % ny;
        const s1 = source[loin]!;
        const ux = Math.floor(s1 / ny) - pi;
        const uy = (s1 % ny) - pj;
        const d1 = Math.hypot(ux, uy);
        let d2 = Number.POSITIVE_INFINITY;
        for (const s of appuis) {
          const vx = Math.floor(s / ny) - pi;
          const vy = (s % ny) - pj;
          const dv = Math.hypot(vx, vy);
          if (dv === 0 || d1 === 0) continue;
          if ((ux * vx + uy * vy) / (d1 * dv) <= -0.5 && dv < d2) d2 = dv;
        }
        if (Number.isFinite(d2)) zones.push({ genre: 'pont', mm: (d1 + d2) * pas, aire, z, x, y });
        else zones.push({ genre: 'porte-a-faux', mm: d1 * pas, aire, z, x, y });
      }
    }
  }
  return zones;
}

// ---------------------------------------------------------------------------------------------
// Surplombs inclinés, par les faces

function surplombs(maillage: Maillage, bas: number): ZoneImpression[] {
  const p = maillage.positions;
  const seuil = -Math.sin(((SURPLOMB_MAX_DEG + MARGE_DEG) * Math.PI) / 180);
  // Cases de 1 mm touchées par les faces en surplomb, regroupées en zones (voisinage de 26).
  const cases = new Map<string, number>();
  const aires: number[] = [];
  const pts: [number, number, number][][] = [];
  let n = 0;
  for (let t = 0; t < maillage.triangles; t += 1) {
    const o = t * 9;
    const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!;
    const ux = p[o + 3]! - ax, uy = p[o + 4]! - ay, uz = p[o + 5]! - az;
    const vx = p[o + 6]! - ax, vy = p[o + 7]! - ay, vz = p[o + 8]! - az;
    const nxv = uy * vz - uz * vy;
    const nyv = uz * vx - ux * vz;
    const nzv = ux * vy - uy * vx;
    const l = Math.hypot(nxv, nyv, nzv);
    if (l < 1e-12) continue;
    const nz = nzv / l;
    // Plus couché que 45° (+ marge), mais pas à plat : le plat est compté en couches (ponts).
    if (nz >= seuil || nz < -0.995) continue;
    const zc = (az + p[o + 5]! + p[o + 8]!) / 3;
    if (zc < bas + 0.6) continue;
    // Points de la face tous les ~0,7 mm.
    const pas = Math.max(1, Math.ceil(Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz)) / 0.7));
    const liste: [number, number, number][] = [];
    for (let a = 0; a <= pas; a += 1) {
      for (let b = 0; a + b <= pas; b += 1) {
        liste.push([ax + (ux * a + vx * b) / pas, ay + (uy * a + vy * b) / pas, az + (uz * a + vz * b) / pas]);
      }
    }
    aires.push(l / 2);
    pts.push(liste);
    for (const [x, y, z] of liste) cases.set(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`, -1);
    n += 1;
  }
  if (!n) return [];
  // Zones de cases.
  let zoneId = 0;
  for (const cle of cases.keys()) {
    if (cases.get(cle)! >= 0) continue;
    const pile = [cle];
    cases.set(cle, zoneId);
    while (pile.length) {
      const [x, y, z] = pile.pop()!.split(',').map(Number) as [number, number, number];
      for (let a = -1; a <= 1; a += 1) {
        for (let b = -1; b <= 1; b += 1) {
          for (let c = -1; c <= 1; c += 1) {
            const v = `${x + a},${y + b},${z + c}`;
            if (cases.get(v) === -1) {
              cases.set(v, zoneId);
              pile.push(v);
            }
          }
        }
      }
    }
    zoneId += 1;
  }
  const zones = Array.from({ length: zoneId }, () => ({ aire: 0, zmin: Infinity, zmax: -Infinity, sx: 0, sy: 0, k: 0 }));
  pts.forEach((liste, t) => {
    const [x, y, z] = liste[0]!;
    const id = cases.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`)!;
    const zo = zones[id]!;
    zo.aire += aires[t]!;
    for (const [px, py, pz] of liste) {
      zo.zmin = Math.min(zo.zmin, pz);
      zo.zmax = Math.max(zo.zmax, pz);
      zo.sx += px;
      zo.sy += py;
      zo.k += 1;
    }
  });
  return zones
    .filter((zo) => zo.k > 0)
    .map((zo) => ({ genre: 'surplomb' as const, mm: zo.zmax - zo.zmin, aire: zo.aire, z: zo.zmin - bas, x: zo.sx / zo.k, y: zo.sy / zo.k }));
}

// ---------------------------------------------------------------------------------------------
// Le contrôle

/** « vers l'arrière, à gauche », vu de dessus sur le plateau. */
function endroit(m: Maillage, x: number, y: number): string {
  const tiers = (v: number, a: number, b: number) => (b - a < 1e-9 ? 1 : Math.min(2, Math.max(0, Math.floor(((v - a) / (b - a)) * 3))));
  const cx = tiers(x, m.min[0], m.max[0]);
  const cy = tiers(y, m.min[1], m.max[1]);
  const mots = [['vers l’avant', 'au milieu', 'vers l’arrière'][cy]!, ['à gauche', '', 'à droite'][cx]!].filter(Boolean);
  return `${mots.join(', ')} (x ${fmt(x - m.min[0])}, y ${fmt(y - m.min[1])} mm)`;
}

/**
 * Contrôle d'impression sans support d'une pièce posée telle quelle sur le plateau.
 * `nom` : le nom de la pièce, dit dans chaque phrase (« Socle : pont de 31 mm… »).
 */
export function controlerImpression(maillage: Maillage, nom: string, options: { pas?: number; pontMax?: number } = {}): ControleImpression {
  const pontMax = options.pontMax ?? PONT_MAX_MM;
  if (maillage.triangles === 0) return { ok: true, problemes: [], ponts: [], defauts: [], pas: 0 };
  const g = decouperEnCubes(maillage, options.pas ?? 0.5);
  const enLAir = zonesEnLAir(g);
  const ponts = enLAir.filter((z) => z.genre === 'pont').sort((a, b) => b.mm - a.mm);
  const defauts: ZoneImpression[] = [
    ...ponts.filter((z) => z.mm > pontMax + g.pas),
    ...enLAir.filter((z) => z.genre === 'porte-a-faux' && z.mm > PORTE_A_FAUX_MAX + g.pas),
    ...surplombs(maillage, maillage.min[2]).filter((z) => z.mm >= SURPLOMB_HAUTEUR_MIN && z.aire >= SURPLOMB_AIRE_MIN),
  ];
  const Nom = nom ? `${nom[0]!.toUpperCase()}${nom.slice(1)}` : 'La pièce';
  const problemes = defauts.map((z) => {
    const ou = endroit(maillage, z.x, z.y);
    if (z.genre === 'pont') return `${Nom} : pont de ${fmt(z.mm)} mm sans appui (${pontMax} mm au plus), à ${fmt(z.z)} mm de haut, ${ou}. Il risque de pendre.`;
    if (z.genre === 'porte-a-faux') return `${Nom} : partie en l’air qui avance de ${fmt(z.mm)} mm sans rien dessous, à ${fmt(z.z)} mm de haut, ${ou}. Il faudrait un support.`;
    return `${Nom} : surplomb de plus de ${SURPLOMB_MAX_DEG}° sur ${fmt(z.aire / 100)} cm², de ${fmt(z.z)} à ${fmt(z.z + z.mm)} mm de haut, ${ou}. Il faudrait un support.`;
  });
  return { ok: problemes.length === 0, problemes, ponts, defauts, pas: g.pas };
}
