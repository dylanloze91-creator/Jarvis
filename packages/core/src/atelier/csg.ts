/**
 * Atelier 3D : petit moteur de formes qui écrit de l'OpenSCAD, avec les mêmes formes que
 * `reference/sources/csg.py` de la mission des boîtiers (pavé à arêtes verticales arrondies,
 * cylindre ou cône, prisme, tronc de pyramide arrondi, union, différence, intersection,
 * déplacement, rotation, miroir). Les manières de tenir un composant (`tenir.ts`) et le boîtier
 * électronique s'écrivent avec lui, presque ligne à ligne comme `hub.py`.
 *
 * Pur : des chaînes de caractères, aucune dépendance. Unités : mm et degrés.
 */

/** Facettes des cylindres et des arrondis (comme `FN = 96` de la référence). */
export const FN = 96;

export interface Forme {
  scad: string;
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
  if (rr <= 0) return { scad: `translate(${v3([x0, y0, z0])}) cube(${v3([w, d, h])});` };
  return {
    scad: `translate(${v3([x0 + rr, y0 + rr, z0])}) linear_extrude(height = ${n(h)}) offset(r = ${n(rr)}, $fn = ${FN}) square([${n(w - 2 * rr)}, ${n(d - 2 * rr)}]);`,
  };
}

/** Cylindre (ou cône) d'axe z, centre (cx, cy), de z0 à z1, rayon r0 en bas et r1 en haut. */
export function cyl(cx: number, cy: number, z0: number, z1: number, r0: number, r1 = r0): Forme {
  if (!(z1 > z0)) throw new Error('cylindre vide');
  return { scad: `translate(${v3([cx, cy, z0])}) cylinder(h = ${n(z1 - z0)}, r1 = ${n(r0)}, r2 = ${n(r1)}, $fn = ${FN});` };
}

/** Polygone (liste de [x, y]) tiré de z0 à z1. */
export function prisme(pts: readonly [number, number][], z0: number, z1: number): Forme {
  return { scad: `translate([0, 0, ${n(z0)}]) linear_extrude(height = ${n(z1 - z0)}) polygon([${pts.map(([x, y]) => `[${n(x)}, ${n(y)}]`).join(', ')}]);` };
}

/**
 * Tronc de pyramide à base rectangle arrondi : enveloppe de deux rectangles arrondis centrés sur
 * (cx, cy), l'un en z0 (w0 × h0, rayon r0), l'autre en z1 (w1 × h1, rayon r1).
 */
export function tronc(cx: number, cy: number, z0: number, z1: number, w0: number, h0: number, r0: number, w1: number, h1: number, r1: number): Forme {
  const plaque = (w: number, h: number, r: number, z: number) =>
    `translate(${v3([cx, cy, z])}) linear_extrude(height = 0.001) offset(r = ${n(r)}, $fn = ${FN}) square([${n(w - 2 * r)}, ${n(h - 2 * r)}], center = true);`;
  return { scad: `hull() { ${plaque(w0, h0, r0, z0)} ${plaque(w1, h1, r1, z1 - 0.001)} }` };
}

export function union(...formes: (Forme | null | undefined)[]): Forme {
  const f = formes.filter((x): x is Forme => Boolean(x));
  if (f.length === 1) return f[0]!;
  return { scad: `union() { ${f.map((x) => x.scad).join(' ')} }` };
}

export function diff(base: Forme, ...trous: (Forme | null | undefined)[]): Forme {
  const t = trous.filter((x): x is Forme => Boolean(x));
  if (!t.length) return base;
  return { scad: `difference() { ${base.scad} ${t.map((x) => x.scad).join(' ')} }` };
}

export function inter(a: Forme, b: Forme): Forme {
  return { scad: `intersection() { ${a.scad} ${b.scad} }` };
}

export function deplacer(f: Forme, t: readonly [number, number, number]): Forme {
  return { scad: `translate(${v3(t)}) { ${f.scad} }` };
}

/** Rotation d'angle `a` (degrés) autour de x, y ou z, dans le sens d'OpenSCAD. */
export function tournerForme(f: Forme, axe: 'x' | 'y' | 'z', a: number): Forme {
  const v: [number, number, number] = axe === 'x' ? [a, 0, 0] : axe === 'y' ? [0, a, 0] : [0, 0, a];
  return { scad: `rotate(${v3(v)}) { ${f.scad} }` };
}

/** Miroir par rapport au plan normal à l'axe donné. */
export function miroir(f: Forme, axe: 'x' | 'y' | 'z'): Forme {
  const v: [number, number, number] = axe === 'x' ? [1, 0, 0] : axe === 'y' ? [0, 1, 0] : [0, 0, 1];
  return { scad: `mirror(${v3(v)}) { ${f.scad} }` };
}

/** Le fichier OpenSCAD d'une pièce. */
export function fichierScad(titre: string, f: Forme): string {
  return `// ${titre} — pièce écrite par Jarvis (atelier 3D). Unités : mm.\n${f.scad}\n`;
}
