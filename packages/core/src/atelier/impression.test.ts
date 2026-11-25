import { describe, expect, it } from 'vitest';
import { controlerImpression, decouperEnCubes, PONT_MAX_MM } from './impression.js';
import { ecrireStlBinaire, lireStl, type Maillage } from './stl.js';

type P = [number, number, number];

/** Triangles d'un solide convexe, tournés vers l'extérieur (le centre du solide est dedans). */
function convexe(faces: P[][]): number[] {
  const tous = faces.flat();
  const c = tous.reduce((a, p) => [a[0] + p[0] / tous.length, a[1] + p[1] / tous.length, a[2] + p[2] / tous.length] as P, [0, 0, 0] as P);
  const out: number[] = [];
  for (const f of faces) {
    for (let i = 1; i + 1 < f.length; i += 1) {
      const a = f[0]!;
      let [b, d] = [f[i]!, f[i + 1]!];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const m = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]];
      if (n[0]! * m[0]! + n[1]! * m[1]! + n[2]! * m[2]! < 0) [b, d] = [d, b];
      out.push(...a, ...b, ...d);
    }
  }
  return out;
}

function pave(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const p = (x: number, y: number, z: number): P => [x, y, z];
  return convexe([
    [p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0)],
    [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)],
    [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)],
    [p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)],
    [p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1), p(x0, y0, z1)],
    [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)],
  ]);
}

/** Prisme : polygone convexe dans le plan (x, z), tiré le long de y de 0 à `l`. */
function prisme(poly: [number, number][], l: number): number[] {
  const avant = poly.map(([x, z]) => [x, 0, z] as P);
  const arriere = poly.map(([x, z]) => [x, l, z] as P);
  const cotes = poly.map((_, i) => {
    const j = (i + 1) % poly.length;
    return [avant[i]!, avant[j]!, arriere[j]!, arriere[i]!];
  });
  return convexe([avant, arriere, ...cotes]);
}

function maillage(...morceaux: number[][]): Maillage {
  return lireStl(ecrireStlBinaire(morceaux.flat()));
}

describe('contrôle d’impression : découpage en cubes', () => {
  it('un pavé plein donne tous ses cubes', () => {
    const g = decouperEnCubes(maillage(pave(0, 0, 0, 10, 6, 4)), 0.5);
    expect([g.nx, g.ny, g.nz]).toEqual([20, 12, 8]);
    expect(g.plein.reduce((a, b) => a + b, 0)).toBe(20 * 12 * 8);
  });
});

describe('contrôle d’impression : ponts', () => {
  it('pont de 30 mm entre deux piliers : refusé, avec la pièce et l’endroit', () => {
    const m = maillage(pave(0, 0, 0, 10, 10, 20), pave(40, 0, 0, 50, 10, 20), pave(0, 0, 20, 50, 10, 23));
    const c = controlerImpression(m, 'table');
    expect(c.ok).toBe(false);
    expect(c.ponts[0]!.genre).toBe('pont');
    expect(c.ponts[0]!.mm).toBeGreaterThan(29);
    expect(c.ponts[0]!.mm).toBeLessThan(31.5);
    expect(c.problemes[0]).toMatch(/^Table : pont de (?:29,5|3\d(?:,\d)?) mm sans appui \(25 mm au plus\), à 20 mm de haut/);
  });

  it('pont de 20 mm : accepté (le pont reste compté)', () => {
    const m = maillage(pave(0, 0, 0, 10, 10, 20), pave(30, 0, 0, 40, 10, 20), pave(0, 0, 20, 40, 10, 23));
    const c = controlerImpression(m, 'table');
    expect(c.ok).toBe(true);
    expect(c.ponts[0]!.mm).toBeGreaterThan(19);
    expect(c.ponts[0]!.mm).toBeLessThanOrEqual(PONT_MAX_MM);
  });

  it('plaque qui avance de 15 mm d’un seul côté : porte-à-faux refusé', () => {
    const m = maillage(pave(0, 0, 0, 10, 10, 20), pave(0, 0, 20, 25, 10, 23));
    const c = controlerImpression(m, 'potence');
    expect(c.ok).toBe(false);
    expect(c.defauts[0]!.genre).toBe('porte-a-faux');
    expect(c.problemes[0]).toMatch(/^Potence : partie en l’air qui avance de 1[45](,\d)? mm/);
  });

  it('rebord de 1,5 mm sans chanfrein : accepté', () => {
    const m = maillage(pave(0, 0, 0, 10, 10, 20), pave(0, 0, 20, 11.5, 10, 22));
    expect(controlerImpression(m, 'marche').ok).toBe(true);
  });
});

describe('contrôle d’impression : surplombs', () => {
  it('pente à 45° : acceptée ; pente à 60° sur 10 mm de haut : refusée', () => {
    const a45 = maillage(prisme([[0, 0], [10, 0], [20, 10], [0, 10]], 30));
    expect(controlerImpression(a45, 'chanfrein').ok).toBe(true);
    const a60 = maillage(prisme([[0, 0], [10, 0], [27.3, 10], [0, 10]], 30));
    const c = controlerImpression(a60, 'console');
    expect(c.ok).toBe(false);
    expect(c.problemes.some((p) => /^Console : surplomb de plus de 45° sur \d/.test(p))).toBe(true);
  });

  it('bord évasé à 60° sur 1,2 mm : accepté (trop bas pour pendre)', () => {
    const m = maillage(prisme([[0, 0], [10, 0], [12, 1.2], [0, 1.2]], 30), pave(0, 0, 1.2, 12, 30, 5));
    expect(controlerImpression(m, 'façade').ok).toBe(true);
  });

  it('pièce vide : rien à dire', () => {
    expect(controlerImpression(lireStl(ecrireStlBinaire([])), 'rien').ok).toBe(true);
  });
});
