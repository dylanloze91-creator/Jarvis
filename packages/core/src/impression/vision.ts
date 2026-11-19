/**
 * Vision par règles, objet par objet. Pur : des images en niveaux de gris, aucune bibliothèque,
 * aucun modèle d'IA. Le PC décode la photo de la caméra (JPEG → niveaux de gris, 640 pixels de
 * large conseillés) et appelle ces fonctions.
 *
 * Principe : on compare deux photos prises au même endroit (tête garée à chaque couche, ou
 * caméra fixée au plateau). On sait où chaque objet doit être sur l'image (géométrie de
 * `camera3d.ts` et polygones des objets donnés par Klipper ou par le G-code). Ce qui change :
 * - dans la bande qui vient d'être imprimée en haut d'un objet : normal (« attendu ») ;
 * - dans la partie déjà imprimée d'un objet : l'objet a bougé, s'est décollé (« bas ») ;
 * - sur la feuille, loin de tout objet : de la matière là où il ne devrait rien y avoir —
 *   fils (« spaghetti »), pièce traînée, impression dans le vide (« dehors ») ;
 * - partout d'un coup : la lumière ou la caméra a changé (« saut »), on ne conclut rien.
 * La tête et le portique, qui cachent une partie de l'image, sont retirés de la comparaison.
 */
import { projeter, type Camera, type Point2, type Point3 } from './camera3d.js';

export interface ImageGris {
  largeur: number;
  hauteur: number;
  /** Un octet par pixel, ligne par ligne. */
  pixels: Uint8Array;
}

export interface ObjetVu {
  nom: string;
  /** Contour au sol (coordonnées imprimante, mm), comme `exclude_object` de Klipper. */
  polygone: readonly Point2[];
  /** Hauteur finale de l'objet (mm), si le G-code a été lu. */
  hauteurMax?: number;
}

export interface Feuille {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Ce que la photo montre de la position de la machine. */
export interface PositionVue {
  /** Position de la tête (mm) au moment de la photo. */
  tete: Point3;
  /** Hauteur déjà imprimée (mm). */
  z: number;
}

export const VISION_REGLAGES = {
  /** Côté d'un bloc de comparaison (pixels). */
  bloc: 4,
  /** Écart de gris qui compte comme un changement. */
  seuilPixel: 28,
  /** Pixels changés sur 16 pour qu'un bloc compte. */
  pixelsParBloc: 6,
  /** Part des blocs de la feuille qui change d'un coup : lumière ou caméra, pas un objet. */
  saut: 0.35,
  /** Marge autour de la zone attendue d'un objet (pixels). */
  margeAttendu: 3,
  /** Marge autour d'un objet avant de parler de matière « dehors » (pixels). */
  margeObjet: 4,
  /** Bande attendue au-dessus et au-dessous de la hauteur imprimée (mm). */
  bandeMm: 1,
  /** Tête et portique (mm), retirés de l'image. */
  tete: { demiLargeur: 35, devant: 35, derriere: 45, dessous: 2, dessus: 60 },
  portique: { demiProfondeur: 20, dessus: 70, gauche: -40, droite: 340 },
} as const;

// --- Géométrie plane ---------------------------------------------------------------------

/** Enveloppe convexe (chaîne monotone), sens trigonométrique. */
export function enveloppe(points: readonly Point2[]): Point2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Distance d'un point à un polygone convexe (0 dedans). */
export function distancePolygone(p: Point2, poly: readonly Point2[]): number {
  if (poly.length === 0) return Infinity;
  if (poly.length === 1) return Math.hypot(p[0] - poly[0]![0], p[1] - poly[0]![1]);
  let dedans = poly.length >= 3;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cross < 0) dedans = false;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return dedans ? 0 : best;
}

/** Image d'une boîte (coordonnées imprimante) : enveloppe des 8 coins projetés. */
function zoneBoite(cam: Camera, min: Point3, max: Point3, teteY: number, monde = false): Point2[] {
  const pts: Point2[] = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const q = monde ? projeterBrut(cam, [x, y, z]) : projeter(cam, [x, y, z], teteY);
        if (q) pts.push(q);
      }
  return enveloppe(pts);
}

function projeterBrut(cam: Camera, w: Point3): Point2 | null {
  const P = cam.P;
  const s = P[8]! * w[0] + P[9]! * w[1] + P[10]! * w[2] + P[11]!;
  if (s <= 1e-9) return null;
  return [(P[0]! * w[0] + P[1]! * w[1] + P[2]! * w[2] + P[3]!) / s, (P[4]! * w[0] + P[5]! * w[1] + P[6]! * w[2] + P[7]!) / s];
}

/** Image d'un objet entre deux hauteurs (prisme de son contour). */
export function zonePrisme(cam: Camera, polygone: readonly Point2[], z0: number, z1: number, teteY: number): Point2[] {
  const pts: Point2[] = [];
  for (const [x, y] of polygone)
    for (const z of [z0, z1]) {
      const q = projeter(cam, [x, y, z], teteY);
      if (q) pts.push(q);
    }
  return enveloppe(pts);
}

/** Image de la feuille (rectangle au sol). */
export function zoneFeuille(cam: Camera, f: Feuille, teteY: number, dx = 0, dy = 0): Point2[] {
  return zonePrisme(
    cam,
    [
      [f.minX + dx, f.minY + dy],
      [f.maxX + dx, f.minY + dy],
      [f.maxX + dx, f.maxY + dy],
      [f.minX + dx, f.maxY + dy],
    ],
    0,
    0,
    teteY,
  );
}

/** Ce que la tête et le portique cachent sur l'image, pour une position de tête. */
export function zonesCachees(cam: Camera, tete: Point3): Point2[][] {
  const t = VISION_REGLAGES.tete;
  const g = VISION_REGLAGES.portique;
  const [X, Y, Z] = tete;
  if (cam.montage === 'cadre') {
    // Repère de la caméra : la buse est en (X, 0, Z), le portique ne bouge qu'en Z.
    return [
      zoneBoite(cam, [X - t.demiLargeur, -t.devant, Z - t.dessous], [X + t.demiLargeur, t.derriere, Z + t.dessus], 0, true),
      zoneBoite(cam, [g.gauche, -g.demiProfondeur, Z + 10], [g.droite, g.demiProfondeur, Z + g.dessus], 0, true),
    ];
  }
  return [
    zoneBoite(cam, [X - t.demiLargeur, Y - t.devant, Z - t.dessous], [X + t.demiLargeur, Y + t.derriere, Z + t.dessus], Y),
    zoneBoite(cam, [g.gauche, Y - g.demiProfondeur, Z + 10], [g.droite, Y + g.demiProfondeur, Z + g.dessus], Y),
  ];
}

// --- Comparaison de deux images ------------------------------------------------------------

/** Différence moyenne de luminosité (médiane), pour ne pas confondre la lumière et un objet. */
export function decalageLumiere(a: ImageGris, b: ImageGris): number {
  const histo = new Array<number>(511).fill(0);
  let n = 0;
  for (let i = 0; i < a.pixels.length; i += 7) {
    histo[b.pixels[i]! - a.pixels[i]! + 255]!++;
    n++;
  }
  let cumul = 0;
  for (let d = 0; d < histo.length; d++) {
    cumul += histo[d]!;
    if (cumul * 2 >= n) return d - 255;
  }
  return 0;
}

/** Centres des blocs qui ont changé entre deux images de même taille. */
export function blocsChanges(a: ImageGris, b: ImageGris): Point2[] {
  if (a.largeur !== b.largeur || a.hauteur !== b.hauteur) throw new Error('Images de tailles différentes.');
  const { bloc, seuilPixel, pixelsParBloc } = VISION_REGLAGES;
  const decal = decalageLumiere(a, b);
  const out: Point2[] = [];
  for (let by = 0; by + bloc <= a.hauteur; by += bloc) {
    for (let bx = 0; bx + bloc <= a.largeur; bx += bloc) {
      let n = 0;
      for (let y = by; y < by + bloc; y++) {
        const ligne = y * a.largeur;
        for (let x = bx; x < bx + bloc; x++) {
          if (Math.abs(b.pixels[ligne + x]! - a.pixels[ligne + x]! - decal) > seuilPixel) n++;
        }
      }
      if (n >= pixelsParBloc) out.push([bx + bloc / 2, by + bloc / 2]);
    }
  }
  return out;
}

function nombreBlocsDans(poly: readonly Point2[], largeur: number, hauteur: number): number {
  if (poly.length < 3) return 0;
  const bloc = VISION_REGLAGES.bloc;
  let n = 0;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) / bloc) * bloc);
  const x1 = Math.min(largeur, Math.max(...xs));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) / bloc) * bloc);
  const y1 = Math.min(hauteur, Math.max(...ys));
  for (let y = y0; y + bloc <= y1 + bloc; y += bloc)
    for (let x = x0; x + bloc <= x1 + bloc; x += bloc) if (distancePolygone([x + bloc / 2, y + bloc / 2], poly) === 0) n++;
  return n;
}

export interface MesureObjet {
  /** Blocs changés là où l'objet grandit : normal. */
  attendu: number;
  /** Blocs changés dans la partie déjà imprimée : l'objet a bougé ou s'est décollé. */
  bas: number;
  /** Blocs changés sur la feuille, près de cet objet mais hors de lui : matière en trop. */
  dehors: number;
}

export interface Comparaison {
  /** La lumière ou la caméra a changé d'un coup : rien n'est conclu. */
  saut: boolean;
  /** Part de la feuille libre (hors objets) qui a changé. */
  partChangee: number;
  parObjet: Record<string, MesureObjet>;
}

export interface ContexteComparaison {
  cam: Camera;
  feuille: Feuille;
  objets: readonly ObjetVu[];
  /** Objets arrêtés : ce qui bouge autour d'eux n'est plus compté. */
  exclus?: readonly string[];
  avant: PositionVue;
  apres: PositionVue;
}

/**
 * Compare deux photos prises au même endroit du plateau (même Y de tête pour une caméra fixée
 * au cadre). Rend, pour chaque objet, ce qui a changé de normal et d'anormal.
 */
export function comparer(avant: ImageGris, apres: ImageGris, ctx: ContexteComparaison): Comparaison {
  const { cam, objets } = ctx;
  const R = VISION_REGLAGES;
  const teteY = ctx.apres.tete[1];
  const feuille = zoneFeuille(cam, ctx.feuille, teteY);
  const cachees = [...zonesCachees(cam, ctx.avant.tete), ...zonesCachees(cam, ctx.apres.tete)];
  const zAvant = Math.max(0, ctx.avant.z);
  const zApres = Math.max(zAvant, ctx.apres.z);
  const exclus = new Set(ctx.exclus ?? []);

  const zones = objets.map((o) => {
    const haut = o.hauteurMax !== undefined ? Math.min(o.hauteurMax, zApres) : zApres;
    const hautAvant = o.hauteurMax !== undefined ? Math.min(o.hauteurMax, zAvant) : zAvant;
    return {
      nom: o.nom,
      exclu: exclus.has(o.nom),
      tout: zonePrisme(cam, o.polygone, 0, haut + R.bandeMm, teteY),
      attendu: zonePrisme(cam, o.polygone, Math.max(0, hautAvant - R.bandeMm), haut + R.bandeMm, teteY),
      bas: hautAvant - R.bandeMm > 0.3 ? zonePrisme(cam, o.polygone, 0, hautAvant - R.bandeMm, teteY) : [],
      centre: centreImage(cam, o.polygone, teteY),
    };
  });
  const parObjet: Record<string, MesureObjet> = {};
  for (const z of zones) parObjet[z.nom] = { attendu: 0, bas: 0, dehors: 0 };

  // « saut » : on regarde seulement la feuille loin des objets (les objets qui grandissent ne comptent pas).
  let horsObjets = 0;
  for (const c of blocsChanges(avant, apres)) {
    if (cachees.some((poly) => distancePolygone(c, poly) <= 2)) continue;
    const dansFeuille = distancePolygone(c, feuille) === 0;
    // Près d'un objet arrêté : ses restes peuvent bouger, on ne compte rien.
    if (zones.some((z) => z.exclu && distancePolygone(c, z.tout) <= R.margeObjet * 3)) continue;
    const attendu = zones.find((z) => !z.exclu && distancePolygone(c, z.attendu) <= R.margeAttendu);
    if (attendu) {
      parObjet[attendu.nom]!.attendu++;
      continue;
    }
    const bas = zones.find((z) => !z.exclu && z.bas.length > 0 && distancePolygone(c, z.bas) === 0);
    if (bas) {
      parObjet[bas.nom]!.bas++;
      continue;
    }
    if (!dansFeuille) continue;
    if (zones.some((z) => !z.exclu && distancePolygone(c, z.tout) <= R.margeObjet)) continue;
    horsObjets++;
    let proche: (typeof zones)[number] | null = null;
    let best = Infinity;
    for (const z of zones) {
      if (z.exclu) continue;
      const d = Math.hypot(c[0] - z.centre[0], c[1] - z.centre[1]);
      if (d < best) {
        best = d;
        proche = z;
      }
    }
    if (proche) parObjet[proche.nom]!.dehors++;
  }
  const occupe = zones.reduce((s, z) => s + nombreBlocsDans(z.tout, avant.largeur, avant.hauteur), 0);
  const total = Math.max(1, nombreBlocsDans(feuille, avant.largeur, avant.hauteur) - occupe);
  const partChangee = horsObjets / total;
  return { saut: partChangee > R.saut, partChangee, parObjet };
}

function centreImage(cam: Camera, polygone: readonly Point2[], teteY: number): Point2 {
  const cx = polygone.reduce((s, p) => s + p[0], 0) / Math.max(1, polygone.length);
  const cy = polygone.reduce((s, p) => s + p[1], 0) / Math.max(1, polygone.length);
  return projeter(cam, [cx, cy, 0], teteY) ?? [0, 0];
}

// --- Feuille décalée -------------------------------------------------------------------------

function gradient(img: ImageGris, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= img.largeur - 1 || yi >= img.hauteur - 1) return -1;
  const p = img.pixels;
  const w = img.largeur;
  const gx = p[yi * w + xi + 1]! - p[yi * w + xi - 1]!;
  const gy = p[(yi + 1) * w + xi]! - p[(yi - 1) * w + xi]!;
  return Math.hypot(gx, gy);
}

/** Force moyenne des bords de la feuille si elle était décalée de (dx, dy) mm (le plus faible des 4 bords compte). */
export function scoreBords(img: ImageGris, cam: Camera, f: Feuille, teteY: number, dx: number, dy: number): number {
  const parBord = scoreParBord(img, cam, f, teteY, dx, dy);
  return parBord.length === 4 ? (parBord.reduce((s, v) => s + v, 0) / 4 + Math.min(...parBord)) / 2 : 0;
}

/** Force moyenne de chacun des 4 bords (les bords hors de l'image sont omis). */
export function scoreParBord(img: ImageGris, cam: Camera, f: Feuille, teteY: number, dx: number, dy: number): number[] {
  const coins: Point3[] = [
    [f.minX + dx, f.minY + dy, 0],
    [f.maxX + dx, f.minY + dy, 0],
    [f.maxX + dx, f.maxY + dy, 0],
    [f.minX + dx, f.maxY + dy, 0],
  ];
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = coins[i]!;
    const b = coins[(i + 1) % 4]!;
    let total = 0;
    let n = 0;
    for (let t = 0.05; t <= 0.95; t += 0.01) {
      const q = projeter(cam, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0], teteY);
      if (!q) continue;
      const g = gradient(img, q[0], q[1]);
      if (g < 0) continue;
      total += g;
      n++;
    }
    if (n >= 20) out.push(total / n);
  }
  return out;
}

export interface MesureFeuille {
  /** Décalage mesuré (mm) ; `null` si les bords ne se voient pas assez. */
  dx: number | null;
  dy: number | null;
  /** Force des bords à la meilleure position et à la position prévue. */
  score: number;
  scorePrevu: number;
}

/**
 * Mesure le décalage de la feuille sur une photo du plateau vide : on cherche la position
 * (au demi-millimètre, ±15 mm) où les quatre bords de la feuille projetés tombent sur des bords
 * nets. `dx`, `dy` à `null` : les bords ne se voient pas (feuille absente, caméra mal placée).
 */
export function mesurerFeuille(img: ImageGris, cam: Camera, f: Feuille, teteY: number, portee = 15): MesureFeuille {
  const scorePrevu = scoreBords(img, cam, f, teteY, 0, 0);
  let best = { dx: 0, dy: 0, s: -1 };
  for (let dx = -portee; dx <= portee; dx += 1)
    for (let dy = -portee; dy <= portee; dy += 1) {
      const s = scoreBords(img, cam, f, teteY, dx, dy);
      if (s > best.s) best = { dx, dy, s };
    }
  for (let dx = best.dx - 1; dx <= best.dx + 1; dx += 0.5)
    for (let dy = best.dy - 1; dy <= best.dy + 1; dy += 0.5) {
      const s = scoreBords(img, cam, f, teteY, dx, dy);
      if (s > best.s) best = { dx, dy, s };
    }
  // Les 4 bords doivent se voir nettement : sinon, feuille absente ou bords cachés.
  if (best.s < 12 || Math.min(...scoreParBord(img, cam, f, teteY, best.dx, best.dy)) < 10) {
    return { dx: null, dy: null, score: best.s, scorePrevu };
  }
  return { dx: best.dx, dy: best.dy, score: best.s, scorePrevu };
}

// --- Restes sur le plateau avant de lancer --------------------------------------------------

/** Point de l'image ramené sur le plateau (z = 0), en coordonnées imprimante. */
export function versPlateau(cam: Camera, p: Point2, teteY: number): Point2 | null {
  const P = cam.P;
  const dy = cam.montage === 'cadre' ? -teteY : 0;
  // Homographie du sol : colonnes x, y et constante (y du monde = y − Y pour le cadre).
  const H = [
    [P[0]!, P[1]!, P[3]! + P[1]! * dy],
    [P[4]!, P[5]!, P[7]! + P[5]! * dy],
    [P[8]!, P[9]!, P[11]! + P[9]! * dy],
  ];
  const [a, b, c] = H[0]!;
  const [d, e, f] = H[1]!;
  const [g, h, i] = H[2]!;
  const det = a! * (e! * i! - f! * h!) - b! * (d! * i! - f! * g!) + c! * (d! * h! - e! * g!);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    [(e! * i! - f! * h!) / det, (c! * h! - b! * i!) / det, (b! * f! - c! * e!) / det],
    [(f! * g! - d! * i!) / det, (a! * i! - c! * g!) / det, (c! * d! - a! * f!) / det],
    [(d! * h! - e! * g!) / det, (b! * g! - a! * h!) / det, (a! * e! - b! * d!) / det],
  ];
  const s = inv[2]![0]! * p[0] + inv[2]![1]! * p[1] + inv[2]![2]!;
  if (Math.abs(s) < 1e-12) return null;
  return [(inv[0]![0]! * p[0] + inv[0]![1]! * p[1] + inv[0]![2]!) / s, (inv[1]![0]! * p[0] + inv[1]![1]! * p[1] + inv[1]![2]!) / s];
}

/** « au fond à gauche », « au milieu »… pour un point du plateau. */
export function endroitPlateau(p: Point2, f: Feuille): string {
  const fx = (p[0] - f.minX) / (f.maxX - f.minX);
  const fy = (p[1] - f.minY) / (f.maxY - f.minY);
  const lr = fx < 0.33 ? 'à gauche' : fx > 0.67 ? 'à droite' : '';
  const fb = fy < 0.33 ? 'devant' : fy > 0.67 ? 'au fond' : '';
  if (!lr && !fb) return 'au milieu';
  return [fb, lr].filter(Boolean).join(' ');
}

export interface RestesPlateau {
  /** Blocs changés sur la feuille par rapport à la photo du plateau vide. */
  blocs: number;
  /** Où, sur le plateau (coordonnées imprimante), et en mots. */
  centre: Point2 | null;
  endroit: string | null;
}

/** Compare la photo du plateau avant de lancer à la photo du plateau vide (même position). */
export function restesSurPlateau(vide: ImageGris, actuelle: ImageGris, cam: Camera, feuille: Feuille, tete: Point3): RestesPlateau {
  const zone = zoneFeuille(cam, feuille, tete[1]);
  const cachees = zonesCachees(cam, tete);
  const blocs = blocsChanges(vide, actuelle).filter((c) => distancePolygone(c, zone) === 0 && !cachees.some((p) => distancePolygone(c, p) <= 2));
  if (blocs.length < 4) return { blocs: blocs.length, centre: null, endroit: null };
  const u = blocs.reduce((s, b) => s + b[0], 0) / blocs.length;
  const v = blocs.reduce((s, b) => s + b[1], 0) / blocs.length;
  const centre = versPlateau(cam, [u, v], tete[1]);
  return { blocs: blocs.length, centre, endroit: centre ? endroitPlateau(centre, feuille) : null };
}

// --- Caméra bougée -------------------------------------------------------------------------

/** Écart moyen (niveaux de gris) sur les points du décor au-delà duquel la caméra a bougé. */
export const DECOR_ECART_MAX = 18;

/**
 * La caméra a-t-elle bougé depuis la photo de départ ? On prend des points bien contrastés du
 * décor (cadre, montants, mur), hors du plateau, des objets et de la tête, et on cherche de
 * combien de pixels l'image entière s'est déplacée. Un plateau qui glisse ne déplace pas le décor ;
 * une caméra bousculée, si.
 */
export function decalageDecor(
  depart: ImageGris,
  actuelle: ImageGris,
  cachees: readonly (readonly Point2[])[],
  portee = 6,
): { dx: number; dy: number; ecart: number; bouge: boolean } {
  const w = depart.largeur;
  const h = depart.hauteur;
  const pts: Point2[] = [];
  for (let y = portee + 2; y < h - portee - 2 && pts.length < 600; y += 3)
    for (let x = portee + 2; x < w - portee - 2 && pts.length < 600; x += 3) {
      if (gradient(depart, x, y) < 24) continue;
      if (cachees.some((poly) => distancePolygone([x, y], poly) <= portee + 2)) continue;
      pts.push([x, y]);
    }
  if (pts.length < 30) return { dx: 0, dy: 0, ecart: 0, bouge: false };
  const decal = decalageLumiere(depart, actuelle);
  const cout = (dx: number, dy: number) => {
    let t = 0;
    for (const [x, y] of pts) t += Math.abs(actuelle.pixels[(y + dy) * w + x + dx]! - depart.pixels[y * w + x]! - decal);
    return t / pts.length;
  };
  const zero = cout(0, 0);
  let best = { dx: 0, dy: 0, c: zero };
  for (let dy = -portee; dy <= portee; dy++)
    for (let dx = -portee; dx <= portee; dx++) {
      const c = cout(dx, dy);
      if (c < best.c) best = { dx, dy, c };
    }
  // Petit glissement retrouvé, ou décor qui ne correspond plus du tout (rotation, grand choc).
  const glisse = (best.dx !== 0 || best.dy !== 0) && best.c < zero * 0.6 && zero - best.c > 6;
  return { dx: best.dx, dy: best.dy, ecart: zero, bouge: glisse || zero > DECOR_ECART_MAX };
}
