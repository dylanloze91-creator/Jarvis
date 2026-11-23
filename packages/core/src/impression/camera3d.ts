/**
 * Géométrie de la caméra de l'imprimante : où un point du plateau apparaît sur l'image.
 * Pur : aucun réseau, aucune image.
 *
 * Coordonnées « imprimante » : x, y du plateau (mm, celles du G-code) et z (hauteur, mm).
 * L'Ender 3 S1 Plus est une imprimante à plateau mobile : le plateau avance et recule en Y.
 * - caméra fixée au CADRE : un point (x, y, z) du plateau est vu à la position (x, y − Y, z),
 *   où Y est la position de la tête en Y au moment de la photo ; la buse est en (X, 0, Z) ;
 * - caméra fixée au PLATEAU : le plateau ne bouge pas pour elle, la buse est en (X, Y, Z).
 *
 * Calage : une matrice de projection 3 × 4 (méthode DLT normalisée de Hartley) calculée sur au
 * moins 6 points connus (coins de la feuille, pointe de la buse à deux hauteurs…), cliqués une
 * fois par l'utilisateur sur une image. Des points tous à la même hauteur ne suffisent pas.
 */

export type Montage = 'cadre' | 'plateau';
export type Point2 = readonly [number, number];
export type Point3 = readonly [number, number, number];

export interface Camera {
  /** Matrice 3 × 4, ligne par ligne. */
  P: readonly number[];
  montage: Montage;
  largeur: number;
  hauteur: number;
}

export interface PointCalage {
  /** Point en coordonnées imprimante. */
  point: Point3;
  /** Position de la tête en Y au moment de l'image (sert seulement au montage « cadre »). */
  teteY: number;
  /** Où l'utilisateur l'a cliqué sur l'image (pixels). */
  image: Point2;
}

export class CalageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalageError';
  }
}

/** Erreur moyenne de reprojection (pixels) au-delà de laquelle le calage est refusé. */
export const CALAGE_ERREUR_MAX = 3;

/** Point du plateau dans le repère de la caméra. */
export function versMonde(p: Point3, teteY: number, montage: Montage): Point3 {
  return montage === 'cadre' ? [p[0], p[1] - teteY, p[2]] : p;
}

/** Projection d'un point du monde ; `null` s'il est derrière la caméra. */
export function projeterMonde(P: readonly number[], w: Point3): Point2 | null {
  const x = P[0]! * w[0] + P[1]! * w[1] + P[2]! * w[2] + P[3]!;
  const y = P[4]! * w[0] + P[5]! * w[1] + P[6]! * w[2] + P[7]!;
  const s = P[8]! * w[0] + P[9]! * w[1] + P[10]! * w[2] + P[11]!;
  if (s <= 1e-9) return null;
  return [x / s, y / s];
}

/** Projection d'un point du plateau (coordonnées imprimante) pour une position de tête. */
export function projeter(cam: Camera, p: Point3, teteY: number): Point2 | null {
  return projeterMonde(cam.P, versMonde(p, teteY, cam.montage));
}

/** Résout A·x = b (n × n) par élimination de Gauss avec pivot partiel. `null` si singulier. */
export function resoudre(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]!]);
  const echelle = Math.max(1e-300, ...m.flat().map(Math.abs));
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    if (Math.abs(m[pivot]![c]!) < 1e-10 * echelle) return null;
    [m[c], m[pivot]] = [m[pivot]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

function normalisation(points: number[][], cible: number): { T: number[][]; pts: number[][] } {
  const d = points[0]!.length;
  const centre = Array.from({ length: d }, (_, k) => points.reduce((s, p) => s + p[k]!, 0) / points.length);
  const moy = points.reduce((s, p) => s + Math.hypot(...p.map((v, k) => v - centre[k]!)), 0) / points.length;
  const f = moy > 0 ? cible / moy : 1;
  const T = Array.from({ length: d + 1 }, (_, r) =>
    Array.from({ length: d + 1 }, (_, c) => (r === d ? (c === d ? 1 : 0) : r === c ? f : c === d ? -f * centre[r]! : 0)),
  );
  return { T, pts: points.map((p) => p.map((v, k) => (v - centre[k]!) * f)) };
}

function multiplier(A: number[][], B: number[][]): number[][] {
  return A.map((row) => B[0]!.map((_, c) => row.reduce((s, v, k) => s + v * B[k]![c]!, 0)));
}

function inverse3(T: number[][]): number[][] {
  // T est une similitude [f 0 tx; 0 f ty; 0 0 1].
  const f = T[0]![0]!;
  return [
    [1 / f, 0, -T[0]![2]! / f],
    [0, 1 / f, -T[1]![2]! / f],
    [0, 0, 1],
  ];
}

/** Erreur moyenne de reprojection (pixels) d'un calage sur ses propres points. */
export function erreurCalage(cam: Camera, points: readonly PointCalage[]): number {
  let total = 0;
  for (const p of points) {
    const q = projeter(cam, p.point, p.teteY);
    total += q ? Math.hypot(q[0] - p.image[0], q[1] - p.image[1]) : 1e6;
  }
  return total / points.length;
}

/**
 * Calage de la caméra à partir de points connus. Refuse moins de 6 points, des points tous à
 * la même hauteur (après passage dans le repère de la caméra) et une erreur moyenne > 3 pixels.
 */
export function calerCamera(
  points: readonly PointCalage[],
  montage: Montage,
  largeur: number,
  hauteur: number,
): { camera: Camera; erreur: number } {
  if (points.length < 6) throw new CalageError('Il faut au moins 6 points pour caler la caméra.');
  const monde = points.map((p) => [...versMonde(p.point, p.teteY, montage)]);
  const zs = monde.map((w) => w[2]!);
  if (Math.max(...zs) - Math.min(...zs) < 5) {
    throw new CalageError('Les points sont tous à la même hauteur : ajoute la pointe de la buse à au moins deux hauteurs.');
  }
  const nW = normalisation(monde, Math.sqrt(3));
  const nI = normalisation(points.map((p) => [...p.image]), Math.SQRT2);
  const A: number[][] = [];
  const b: number[] = [];
  nW.pts.forEach(([X, Y, Z], i) => {
    const [u, v] = nI.pts[i]!;
    A.push([X!, Y!, Z!, 1, 0, 0, 0, 0, -u! * X!, -u! * Y!, -u! * Z!]);
    b.push(u!);
    A.push([0, 0, 0, 0, X!, Y!, Z!, 1, -v! * X!, -v! * Y!, -v! * Z!]);
    b.push(v!);
  });
  const AtA = Array.from({ length: 11 }, (_, r) => Array.from({ length: 11 }, (_, c) => A.reduce((s, row) => s + row[r]! * row[c]!, 0)));
  const Atb = Array.from({ length: 11 }, (_, r) => A.reduce((s, row, i) => s + row[r]! * b[i]!, 0));
  const x = resoudre(AtA, Atb);
  if (!x) throw new CalageError('Points mal répartis : impossible de caler la caméra. Prends-les plus écartés.');
  const Pn = [x.slice(0, 4), x.slice(4, 8), [...x.slice(8, 11), 1]];
  const P = multiplier(multiplier(inverse3(nI.T), Pn), nW.T).flat();
  const camera: Camera = { P, montage, largeur, hauteur };
  const erreur = erreurCalage(camera, points);
  if (!(erreur <= CALAGE_ERREUR_MAX)) {
    throw new CalageError(`Calage imprécis (${erreur.toFixed(1)} pixels d'écart en moyenne) : reclique les points plus soigneusement.`);
  }
  return { camera, erreur };
}

/** Caméra construite à partir de sa position et de son point de visée (pour les simulations). */
export function cameraVisee(
  position: Point3,
  vise: Point3,
  focale: number,
  largeur: number,
  hauteur: number,
  montage: Montage,
): Camera {
  const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a: Point3): Point3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const zc = norm(sub(vise, position));
  const xc = norm(cross(zc, [0, 0, 1]));
  const yc = cross(zc, xc);
  const R = [xc, yc, zc];
  const t = R.map((r) => -dot(r, position));
  const cx = largeur / 2;
  const cy = hauteur / 2;
  const P = [0, 1, 2].flatMap((i) => {
    const r = R[i]!;
    const ti = t[i]!;
    if (i === 0) return [focale * r[0] + cx * R[2]![0], focale * r[1] + cx * R[2]![1], focale * r[2] + cx * R[2]![2], focale * ti + cx * t[2]!];
    if (i === 1) return [focale * r[0] + cy * R[2]![0], focale * r[1] + cy * R[2]![1], focale * r[2] + cy * R[2]![2], focale * ti + cy * t[2]!];
    return [r[0], r[1], r[2], ti];
  });
  return { P, montage, largeur, hauteur };
}
