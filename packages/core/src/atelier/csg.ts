/**
 * Atelier 3D : petit moteur de formes qui écrit de l'OpenSCAD, avec les mêmes formes que
 * `reference/sources/csg.py` de la mission des boîtiers (pavé à arêtes verticales arrondies,
 * cylindre ou cône, prisme, tronc de pyramide arrondi, union, différence, intersection,
 * déplacement, rotation, miroir). Les manières de tenir un composant (`tenir.ts`) et le boîtier
 * électronique s'écrivent avec lui, presque ligne à ligne comme `hub.py`.
 *
 * Comme `csg.py`, chaque forme sait aussi dire si un point est dedans (`geo`) : les contrôles du
 * boîtier (collisions, jeux, champ de la caméra) se font sur le même arbre que le .scad rendu par
 * OpenSCAD. Une forme écrite à la main (`{ scad }` seul) n'a pas de `geo` ; une opération qui en
 * contient une n'en a pas non plus.
 *
 * Pur : des chaînes de caractères et des nombres, aucune dépendance. Unités : mm et degrés.
 */

/** Facettes des cylindres et des arrondis (comme `FN = 96` de la référence). */
export const FN = 96;

/** Boîte englobante : [xmin, xmax, ymin, ymax, zmin, zmax]. */
export type Aabb = [number, number, number, number, number, number];

export interface Geo {
  aabb: Aabb;
  /** Le point est-il dans la forme (bords compris) ? Appelé seulement dans `aabb`. */
  dedansBrut(x: number, y: number, z: number): boolean;
}

export interface Forme {
  scad: string;
  geo?: Geo;
}

/** Le point (x, y, z) est-il dans la forme ? Faux si la forme n'a pas de géométrie. */
export function dedans(f: Forme | Geo, x: number, y: number, z: number): boolean {
  const g = 'aabb' in f ? f : f.geo;
  if (!g) return false;
  const b = g.aabb;
  if (x < b[0] || x > b[1] || y < b[2] || y > b[3] || z < b[4] || z > b[5]) return false;
  return g.dedansBrut(x, y, z);
}

function n(x: number): string {
  if (!Number.isFinite(x)) throw new Error('mesure invalide');
  const s = (Math.round(x * 10_000) / 10_000).toString();
  return s === '-0' ? '0' : s;
}

function v3(v: readonly [number, number, number]): string {
  return `[${v.map(n).join(', ')}]`;
}

/** Pavé [x0, x1] × [y0, y1] × [z0, z1], arêtes verticales arrondies de rayon r (0 : vives). */
export function boite(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r = 0): Forme {
  if (!(x1 > x0 && y1 > y0 && z1 > z0)) throw new Error(`pavé vide : ${[x0, x1, y0, y1, z0, z1].join(', ')}`);
  const rr = r > 0 ? Math.min(r, (x1 - x0) / 2 - 1e-6, (y1 - y0) / 2 - 1e-6) : 0;
  const w = x1 - x0;
  const d = y1 - y0;
  const h = z1 - z0;
  const geo: Geo = {
    aabb: [x0, x1, y0, y1, z0, z1],
    dedansBrut(x, y) {
      if (rr <= 0) return true;
      const cx = Math.min(Math.max(x, x0 + rr), x1 - rr);
      const cy = Math.min(Math.max(y, y0 + rr), y1 - rr);
      return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr;
    },
  };
  if (rr <= 0) return { scad: `translate(${v3([x0, y0, z0])}) cube(${v3([w, d, h])});`, geo };
  return {
    scad: `translate(${v3([x0 + rr, y0 + rr, z0])}) linear_extrude(height = ${n(h)}) offset(r = ${n(rr)}, $fn = ${FN}) square([${n(w - 2 * rr)}, ${n(d - 2 * rr)}]);`,
    geo,
  };
}

/** Cylindre (ou cône) d'axe z, centre (cx, cy), de z0 à z1, rayon r0 en bas et r1 en haut. */
export function cyl(cx: number, cy: number, z0: number, z1: number, r0: number, r1 = r0): Forme {
  if (!(z1 > z0)) throw new Error('cylindre vide');
  const R = Math.max(r0, r1);
  return {
    scad: `translate(${v3([cx, cy, z0])}) cylinder(h = ${n(z1 - z0)}, r1 = ${n(r0)}, r2 = ${n(r1)}, $fn = ${FN});`,
    geo: {
      aabb: [cx - R, cx + R, cy - R, cy + R, z0, z1],
      dedansBrut(x, y, z) {
        const r = r0 + ((r1 - r0) * (z - z0)) / (z1 - z0);
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      },
    },
  };
}

/** Polygone (liste de [x, y]) tiré de z0 à z1. */
export function prisme(pts: readonly [number, number][], z0: number, z1: number): Forme {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    scad: `translate([0, 0, ${n(z0)}]) linear_extrude(height = ${n(z1 - z0)}) polygon([${pts.map(([x, y]) => `[${n(x)}, ${n(y)}]`).join(', ')}]);`,
    geo: {
      aabb: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), z0, z1],
      dedansBrut(x, y) {
        let d = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
          const [xi, yi] = pts[i]!;
          const [xj, yj] = pts[j]!;
          if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) d = !d;
        }
        return d;
      },
    },
  };
}

/**
 * Tronc de pyramide à base rectangle arrondi : enveloppe de deux rectangles arrondis centrés sur
 * (cx, cy), l'un en z0 (w0 × h0, rayon r0), l'autre en z1 (w1 × h1, rayon r1).
 */
export function tronc(cx: number, cy: number, z0: number, z1: number, w0: number, h0: number, r0: number, w1: number, h1: number, r1: number): Forme {
  const plaque = (w: number, h: number, r: number, z: number) =>
    `translate(${v3([cx, cy, z])}) linear_extrude(height = 0.001) offset(r = ${n(r)}, $fn = ${FN}) square([${n(w - 2 * r)}, ${n(h - 2 * r)}], center = true);`;
  const W = Math.max(w0, w1) / 2;
  const H = Math.max(h0, h1) / 2;
  return {
    scad: `hull() { ${plaque(w0, h0, r0, z0)} ${plaque(w1, h1, r1, z1 - 0.001)} }`,
    geo: {
      aabb: [cx - W, cx + W, cy - H, cy + H, z0, z1],
      dedansBrut(x, y, z) {
        const t = (z - z0) / (z1 - z0);
        const w = (w0 + (w1 - w0) * t) / 2;
        const h = (h0 + (h1 - h0) * t) / 2;
        const r = r0 + (r1 - r0) * t;
        const qx = Math.abs(x - cx) - (w - r);
        const qy = Math.abs(y - cy) - (h - r);
        if (qx > r || qy > r) return false;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= r;
      },
    },
  };
}

function geos(f: readonly Forme[]): Geo[] | null {
  const g = f.map((x) => x.geo);
  return g.every((x): x is Geo => Boolean(x)) ? g : null;
}

export function union(...formes: (Forme | null | undefined)[]): Forme {
  const f = formes.filter((x): x is Forme => Boolean(x));
  if (f.length === 1) return f[0]!;
  const g = geos(f);
  return {
    scad: `union() { ${f.map((x) => x.scad).join(' ')} }`,
    ...(g && g.length
      ? {
          geo: {
            aabb: [
              Math.min(...g.map((x) => x.aabb[0])),
              Math.max(...g.map((x) => x.aabb[1])),
              Math.min(...g.map((x) => x.aabb[2])),
              Math.max(...g.map((x) => x.aabb[3])),
              Math.min(...g.map((x) => x.aabb[4])),
              Math.max(...g.map((x) => x.aabb[5])),
            ] as Aabb,
            dedansBrut: (x: number, y: number, z: number) => g.some((e) => dedans(e, x, y, z)),
          },
        }
      : {}),
  };
}

export function diff(base: Forme, ...trous: (Forme | null | undefined)[]): Forme {
  const t = trous.filter((x): x is Forme => Boolean(x));
  if (!t.length) return base;
  const gb = base.geo;
  const gt = geos(t);
  return {
    scad: `difference() { ${base.scad} ${t.map((x) => x.scad).join(' ')} }`,
    ...(gb && gt ? { geo: { aabb: gb.aabb, dedansBrut: (x: number, y: number, z: number) => gb.dedansBrut(x, y, z) && !gt.some((e) => dedans(e, x, y, z)) } } : {}),
  };
}

export function inter(a: Forme, b: Forme): Forme {
  const ga = a.geo;
  const gb = b.geo;
  let geo: Geo | undefined;
  if (ga && gb) {
    const A = ga.aabb;
    const B = gb.aabb;
    geo = {
      aabb: [Math.max(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.min(A[3], B[3]), Math.max(A[4], B[4]), Math.min(A[5], B[5])],
      dedansBrut: (x, y, z) => dedans(ga, x, y, z) && dedans(gb, x, y, z),
    };
  }
  return { scad: `intersection() { ${a.scad} ${b.scad} }`, ...(geo ? { geo } : {}) };
}

export function deplacer(f: Forme, t: readonly [number, number, number]): Forme {
  const g = f.geo;
  const [tx, ty, tz] = t;
  return {
    scad: `translate(${v3(t)}) { ${f.scad} }`,
    ...(g
      ? {
          geo: {
            aabb: [g.aabb[0] + tx, g.aabb[1] + tx, g.aabb[2] + ty, g.aabb[3] + ty, g.aabb[4] + tz, g.aabb[5] + tz] as Aabb,
            dedansBrut: (x: number, y: number, z: number) => g.dedansBrut(x - tx, y - ty, z - tz),
          },
        }
      : {}),
  };
}

/** Matrice de rotation d'angle `a` (degrés) autour d'un axe, dans le sens d'OpenSCAD (lignes). */
export function matriceRotation(axe: 'x' | 'y' | 'z', a: number): number[][] {
  const c = Math.cos((a * Math.PI) / 180);
  const s = Math.sin((a * Math.PI) / 180);
  if (axe === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axe === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

/** Rotation d'angle `a` (degrés) autour de x, y ou z, dans le sens d'OpenSCAD. */
export function tournerForme(f: Forme, axe: 'x' | 'y' | 'z', a: number): Forme {
  const v: [number, number, number] = axe === 'x' ? [a, 0, 0] : axe === 'y' ? [0, a, 0] : [0, 0, a];
  const scad = `rotate(${v3(v)}) { ${f.scad} }`;
  const g = f.geo;
  if (!g) return { scad };
  const R = matriceRotation(axe, a);
  const b = g.aabb;
  const coins: number[][] = [];
  for (const x of [b[0], b[1]]) for (const y of [b[2], b[3]]) for (const z of [b[4], b[5]]) coins.push([0, 1, 2].map((i) => R[i]![0]! * x + R[i]![1]! * y + R[i]![2]! * z));
  const lo = (i: number) => Math.min(...coins.map((c) => c[i]!));
  const hi = (i: number) => Math.max(...coins.map((c) => c[i]!));
  return {
    scad,
    geo: {
      aabb: [lo(0), hi(0), lo(1), hi(1), lo(2), hi(2)],
      // point local = Rᵀ p
      dedansBrut: (x, y, z) =>
        dedans(g, R[0]![0]! * x + R[1]![0]! * y + R[2]![0]! * z, R[0]![1]! * x + R[1]![1]! * y + R[2]![1]! * z, R[0]![2]! * x + R[1]![2]! * y + R[2]![2]! * z),
    },
  };
}

/** Miroir par rapport au plan normal à l'axe donné. */
export function miroir(f: Forme, axe: 'x' | 'y' | 'z'): Forme {
  const v: [number, number, number] = axe === 'x' ? [1, 0, 0] : axe === 'y' ? [0, 1, 0] : [0, 0, 1];
  const scad = `mirror(${v3(v)}) { ${f.scad} }`;
  const g = f.geo;
  if (!g) return { scad };
  const k = axe === 'x' ? 0 : axe === 'y' ? 1 : 2;
  const b = [...g.aabb] as Aabb;
  const lo = b[2 * k]!;
  b[2 * k] = -b[2 * k + 1]!;
  b[2 * k + 1] = -lo;
  return {
    scad,
    geo: {
      aabb: b,
      dedansBrut: (x, y, z) => (k === 0 ? g.dedansBrut(-x, y, z) : k === 1 ? g.dedansBrut(x, -y, z) : g.dedansBrut(x, y, -z)),
    },
  };
}

/** Le fichier OpenSCAD d'une pièce. */
export function fichierScad(titre: string, f: Forme): string {
  return `// ${titre} — pièce écrite par Jarvis (atelier 3D). Unités : mm.\n${f.scad}\n`;
}
