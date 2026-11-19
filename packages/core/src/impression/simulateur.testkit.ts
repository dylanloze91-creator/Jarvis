/**
 * Simulateur d'impression pour les essais : il dessine ce que verrait la caméra de l'Ender 3 S1
 * Plus (plateau, feuille, objets qui montent couche par couche, portique, tête garée, fils,
 * lumière qui varie, bruit du capteur), y glisse des pannes, et rejoue toute la chaîne :
 * vision → objet par objet → surveillance.
 *
 * Ce n'est pas une vraie photo : les seuils sont réglés ici et devront être confirmés sur des
 * photos de la vraie imprimante (banc de photos, cahier `docs/specs/imprimante-surveillance.md`).
 * Pour ne pas tricher, l'analyse n'utilise pas la caméra exacte du dessin mais une caméra calée
 * comme le ferait l'utilisateur, à partir de 9 points cliqués avec ±1 pixel d'erreur.
 */
import { calerCamera, cameraVisee, projeter, projeterMonde, type Camera, type Point2, type Point3 } from './camera3d.js';
import { comparer, decalageDecor, enveloppe, zoneFeuille, zonesCachees, zonePrisme, type Comparaison, type Feuille, type ImageGris, type ObjetVu } from './vision.js';
import { etatObjetsInitial, OBJETS_DEFAUT, repondreObjet, stepObjets, type ActionObjet, type EtatObjets, type ReglagesObjets } from './objets.js';
import {
  initialSurveillanceState,
  stepSurveillance,
  type SurveillanceAction,
  type SurveillanceState,
} from './surveillance.js';

export const LARGEUR = 640;
export const HAUTEUR = 480;
/** Position du plateau (Y de la tête) pour les photos « tête garée ». */
export const PARC_Y = 295;
export const FEUILLE: Feuille = { minX: 0, maxX: 300, minY: 0, maxY: 300 };
export const COUCHE = 0.4;
export const SECONDES_PAR_COUCHE = 30;

export function mulberry32(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Caméra du dessin : devant l'imprimante, en hauteur, fixée au cadre. */
export function cameraVraie(decalage: Point3 = [0, 0, 0]): Camera {
  return cameraVisee(
    [150 + decalage[0], -560 + decalage[1], 300 + decalage[2]],
    [150 + decalage[0] * 3, -150, 0],
    560,
    LARGEUR,
    HAUTEUR,
    'cadre',
  );
}

/** Caméra calée comme le ferait l'utilisateur : 9 points cliqués, ±1 pixel. */
export function cameraCalee(vraie: Camera = cameraVraie(), graine = 7): Camera {
  const r = mulberry32(graine);
  const points: { point: Point3; teteY: number }[] = [
    { point: [0, 0, 0], teteY: PARC_Y },
    { point: [300, 0, 0], teteY: PARC_Y },
    { point: [300, 300, 0], teteY: PARC_Y },
    { point: [0, 300, 0], teteY: PARC_Y },
    { point: [30, 150, 10], teteY: 150 },
    { point: [270, 150, 10], teteY: 150 },
    { point: [30, 100, 60], teteY: 100 },
    { point: [270, 200, 60], teteY: 200 },
    { point: [150, 150, 110], teteY: 150 },
  ];
  const cales = points.map((p) => {
    const q = projeter(vraie, p.point, p.teteY)!;
    return { ...p, image: [q[0] + (r() * 2 - 1), q[1] + (r() * 2 - 1)] as Point2 };
  });
  return calerCamera(cales, 'cadre', LARGEUR, HAUTEUR).camera;
}

// --- Dessin --------------------------------------------------------------------------------

export interface Bloc {
  polygone: Point2[];
  z0: number;
  z1: number;
}

export interface Brins {
  centre: Point3;
  rayon: number;
  /** Nombre de fils déjà sortis (chacun reste à sa place d'une image à l'autre). */
  n: number;
  graine: number;
  hauteur: number;
}

export interface Scene {
  sansFeuille?: boolean;
  decalageFeuille?: Point2;
  blocs: Bloc[];
  brins?: Brins[];
  /** Petits fils fins (1 pixel), normaux. */
  filsFins?: [Point3, Point3][];
  tete: Point3;
  lumiere?: number;
  /** Lampe de côté : +x à gauche, 0 à droite. */
  degrade?: number;
  graineBruit: number;
}

function texture(x: number, y: number, a: number): number {
  const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  return ((h % 1000) / 1000) * 2 * a - a;
}

function remplir(img: Float32Array, poly: Point2[], valeur: number, tex = 0): void {
  if (poly.length < 3) return;
  const ys = poly.map((p) => p[1]);
  const y0 = Math.max(0, Math.ceil(Math.min(...ys) - 0.5));
  const y1 = Math.min(HAUTEUR - 1, Math.floor(Math.max(...ys) - 0.5));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const x1 = Math.min(LARGEUR - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = x0; x <= x1; x++) img[y * LARGEUR + x] = valeur + (tex ? texture(x, y, tex) : 0);
    }
  }
}

function trait(img: Float32Array, a: Point2, b: Point2, valeur: number, epais: number): void {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let k = 0; k <= n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n;
    const y = a[1] + ((b[1] - a[1]) * k) / n;
    for (let dy = 0; dy < epais; dy++)
      for (let dx = 0; dx < epais; dx++) {
        const xi = Math.round(x) + dx;
        const yi = Math.round(y) + dy;
        if (xi >= 0 && yi >= 0 && xi < LARGEUR && yi < HAUTEUR) img[yi * LARGEUR + xi] = valeur;
      }
  }
}

function boite(cam: Camera, min: Point3, max: Point3, teteY: number): Point2[] {
  const pts: Point2[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    const q = projeter(cam, [x, y, z], teteY);
    if (q) pts.push(q);
  }
  return enveloppe(pts);
}

function prisme(cam: Camera, poly: Point2[], z0: number, z1: number, teteY: number): Point2[] {
  const pts: Point2[] = [];
  for (const [x, y] of poly) for (const z of [z0, z1]) {
    const q = projeter(cam, [x, y, z], teteY);
    if (q) pts.push(q);
  }
  return enveloppe(pts);
}

export function dessiner(cam: Camera, s: Scene): ImageGris {
  const teteY = s.tete[1];
  const img = new Float32Array(LARGEUR * HAUTEUR);
  for (let y = 0; y < HAUTEUR; y++) for (let x = 0; x < LARGEUR; x++) img[y * LARGEUR + x] = 30 + (y / HAUTEUR) * 20 + texture(x, y, 3);
  // Plateau alu, puis feuille.
  remplir(img, prisme(cam, [[-15, -15], [315, -15], [315, 315], [-15, 315]], -1, -1, teteY), 62, 2);
  if (!s.sansFeuille) {
    const [dx, dy] = s.decalageFeuille ?? [0, 0];
    remplir(img, prisme(cam, [[dx, dy], [300 + dx, dy], [300 + dx, 300 + dy], [dx, 300 + dy]], 0, 0, teteY), 100, 2);
  }
  // Montants du cadre (fixes : ils ne suivent pas le plateau) et leurs vis.
  for (const xm of [-45, 345]) {
    const pts: Point2[] = [];
    for (const x of [xm - 10, xm + 10]) for (const y of [-10, 10]) for (const z of [-60, 400]) {
      const q = projeterMonde(cam.P, [x, y, z]);
      if (q) pts.push(q);
    }
    remplir(img, enveloppe(pts), 4);
    for (let z = 20; z < 380; z += 60) {
      const a = projeterMonde(cam.P, [xm - 6, -10, z]);
      const b = projeterMonde(cam.P, [xm + 6, -10, z + 6]);
      if (a && b) remplir(img, enveloppe([a, [b[0], a[1]], b, [a[0], b[1]]]), 140);
    }
  }
  // Portique et tête (derrière les objets pour cette caméra, côté arrière du plateau).
  const [X, Y, Z] = s.tete;
  remplir(img, boite(cam, [-40, Y - 15, Z + 15], [340, Y + 15, Z + 55], teteY), 75);
  remplir(img, boite(cam, [X - 25, Y - 25, Z], [X + 25, Y + 35, Z + 50], teteY), 48);
  // Objets, du plus loin au plus près, chaque objet de bas en haut.
  const blocs = [...s.blocs].sort((a, b) => {
    const ya = a.polygone.reduce((t, p) => t + p[1], 0) / a.polygone.length;
    const yb = b.polygone.reduce((t, p) => t + p[1], 0) / b.polygone.length;
    return yb - ya || a.z0 - b.z0;
  });
  for (const b of blocs) {
    if (b.z1 <= b.z0) continue;
    remplir(img, prisme(cam, b.polygone, b.z0, b.z1, teteY), 180);
    const dessus = b.polygone.map((p) => projeter(cam, [p[0], p[1], b.z1], teteY)).filter((q): q is Point2 => q !== null);
    remplir(img, enveloppe(dessus), 215);
  }
  // Fils emmêlés.
  for (const br of s.brins ?? []) {
    for (let i = 0; i < br.n; i++) {
      const r = mulberry32(br.graine * 1000 + i);
      let p: Point3 = [br.centre[0] + (r() * 2 - 1) * br.rayon, br.centre[1] + (r() * 2 - 1) * br.rayon, r() * br.hauteur];
      for (let k = 0; k < 10; k++) {
        const q: Point3 = [
          Math.max(br.centre[0] - br.rayon * 1.6, Math.min(br.centre[0] + br.rayon * 1.6, p[0] + (r() * 2 - 1) * 7)),
          Math.max(br.centre[1] - br.rayon * 1.6, Math.min(br.centre[1] + br.rayon * 1.6, p[1] + (r() * 2 - 1) * 7)),
          Math.max(0, Math.min(br.hauteur, p[2] + (r() * 2 - 1) * 4)),
        ];
        const a = projeter(cam, p, teteY);
        const b = projeter(cam, q, teteY);
        if (a && b) trait(img, a, b, 205, 2);
        p = q;
      }
    }
  }
  for (const [a3, b3] of s.filsFins ?? []) {
    const a = projeter(cam, a3, teteY);
    const b = projeter(cam, b3, teteY);
    if (a && b) trait(img, a, b, 150, 1);
  }
  const r = mulberry32(s.graineBruit);
  const out = new Uint8Array(LARGEUR * HAUTEUR);
  for (let y = 0; y < HAUTEUR; y++)
    for (let x = 0; x < LARGEUR; x++) {
      const i = y * LARGEUR + x;
      const v = img[i]! + (s.lumiere ?? 0) + (s.degrade ?? 0) * (1 - x / LARGEUR) + (r() * 8 - 4);
      out[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
  return { largeur: LARGEUR, hauteur: HAUTEUR, pixels: out };
}

// --- Objets et G-code ------------------------------------------------------------------------

export function rect(x0: number, y0: number, x1: number, y1: number): Point2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

export interface ObjetSim {
  nom: string;
  polygone: Point2[];
  hauteur: number;
}

/** Trois pièces côte à côte au milieu du plateau. */
export const TROIS: ObjetSim[] = [
  { nom: 'support_id_0_copy_0', polygone: rect(50, 120, 80, 150), hauteur: 30 },
  { nom: 'support_id_0_copy_1', polygone: rect(135, 120, 165, 150), hauteur: 30 },
  { nom: 'support_id_0_copy_2', polygone: rect(220, 120, 250, 150), hauteur: 30 },
];

function decaler(poly: Point2[], dx: number, dy: number): Point2[] {
  return poly.map(([x, y]) => [x + dx, y + dy] as Point2);
}

// --- Rejouer une impression -------------------------------------------------------------------

export interface ScenarioImpression {
  objets: ObjetSim[];
  couches: number;
  /**
   * Ce que la caméra voit à la couche k (k = 0 : plateau vide au départ). `arretes` : couche où
   * chaque objet arrêté l'a été (plus rien n'y est déposé ensuite).
   */
  scene: (k: number, z: number, arretes: ReadonlyMap<string, number>) => Omit<Scene, 'tete' | 'graineBruit'> & { camera?: Camera };
}

export interface Journal {
  couche: number;
  at: number;
  objets: ActionObjet[];
  surveillance: SurveillanceAction[];
  probleme: string | null;
  doute: string | null;
}

export interface ResultatSimulation {
  journal: Journal[];
  dits: { couche: number; level: string; text: string }[];
  exclusions: { couche: number; nom: string }[];
  pauses: { couche: number; reason: string }[];
  etatObjets: EtatObjets;
  etatSurveillance: SurveillanceState;
}

/** Scène normale : chaque objet monte jusqu'à `z` (sa hauteur au plus). */
export function blocsNormaux(objets: ObjetSim[], z: number): Bloc[] {
  return objets.map((o) => ({ polygone: o.polygone, z0: 0, z1: Math.min(o.hauteur, z) }));
}

export interface OptionsSimulation {
  avecSurveillance?: boolean;
  reglages?: ReglagesObjets;
  /** Réponses de l'utilisateur : à la couche donnée, sur l'objet donné. */
  reponses?: { couche: number; nom: string; reponse: 'arreter' | 'garder' }[];
}

export function simulerImpression(sc: ScenarioImpression, options: OptionsSimulation = {}): ResultatSimulation {
  const vraie = cameraVraie();
  const cam = cameraCalee(vraie);
  const tete = (z: number): Point3 => [5, PARC_Y, z + 5];
  const vus: ObjetVu[] = sc.objets.map((o) => ({ nom: o.nom, polygone: o.polygone, hauteurMax: o.hauteur }));
  const noms = sc.objets.map((o) => o.nom);
  const images: ImageGris[] = [];
  const arretes = new Map<string, number>();
  const rendre = (k: number) => {
    const z = k * COUCHE;
    const { camera, ...scene } = sc.scene(k, z, arretes);
    return dessiner(camera ?? vraie, { ...scene, tete: tete(z), graineBruit: 1000 + k });
  };
  images.push(rendre(0));
  let etatObjets = etatObjetsInitial();
  let reference = 0;
  let enPause = false;
  let etatSurv = initialSurveillanceState();
  const exclus = new Set<string>();
  const res: ResultatSimulation = { journal: [], dits: [], exclusions: [], pauses: [], etatObjets, etatSurveillance: etatSurv };
  for (let k = 1; k <= sc.couches; k++) {
    const z = k * COUCHE;
    const at = k * SECONDES_PAR_COUCHE * 1000;
    const img = rendre(k);
    images.push(img);
    const ctx = (zAvant: number) => ({
      cam,
      feuille: FEUILLE,
      objets: vus,
      exclus: [...exclus],
      avant: { tete: tete(zAvant), z: zAvant },
      apres: { tete: tete(z), z },
    });
    const courte: Comparaison = comparer(images[k - 1]!, img, ctx((k - 1) * COUCHE));
    const refImg = images[reference]!;
    const refComp: Comparaison = comparer(refImg, img, ctx(0));
    const cachees = [
      zoneFeuille(cam, FEUILLE, PARC_Y, -20, -20),
      zoneFeuille(cam, { minX: -20, maxX: 320, minY: -20, maxY: 320 }, PARC_Y),
      ...zonesCachees(cam, tete(0)),
      ...zonesCachees(cam, tete(z)),
      ...vus.map((o) => zonePrisme(cam, o.polygone, 0, (o.hauteurMax ?? z) + 5, PARC_Y)),
    ];
    const cameraBougee = decalageDecor(refImg, img, cachees).bouge;
    let longue = null;
    if (k % 10 === 0 && k >= 10) {
      const z0 = (k - 10) * COUCHE;
      longue = {
        comparaison: comparer(images[k - 10]!, img, ctx(z0)),
        doitGrandir: sc.objets.filter((o) => o.hauteur > z0 + 1.5 && !exclus.has(o.nom)).map((o) => o.nom),
      };
    }
    const avant: ActionObjet[] = [];
    for (const rep of options.reponses ?? []) {
      if (rep.couche !== k) continue;
      const rr = repondreObjet(etatObjets, rep.nom, rep.reponse, at);
      etatObjets = rr.state;
      avant.push(...rr.actions);
    }
    const r0 = stepObjets(etatObjets, { at, objets: noms, exclus: [...exclus], courte, reference: refComp, longue, cameraBougee }, options.reglages ?? OBJETS_DEFAUT);
    const r = { ...r0, actions: [...avant, ...r0.actions] };
    etatObjets = r.state;
    for (const a of r.actions) {
      if (a.kind === 'exclude') {
        exclus.add(a.nom); // Klipper l'aura fait à la lecture suivante.
        arretes.set(a.nom, k);
        res.exclusions.push({ couche: k, nom: a.nom });
        // Les restes de l'objet arrêté ne doivent pas faire accuser ses voisins : nouvelle photo de départ.
        reference = k;
      } else res.dits.push({ couche: k, level: a.level, text: a.text });
    }
    let surv: SurveillanceAction[] = [];
    if (options.avecSurveillance !== false) {
      const s = stepSurveillance(etatSurv, {
        at,
        printer: {
          reachable: true,
          klippy: 'ready',
          status: {
            state: enPause ? 'paused' : 'printing',
            filename: 'plateau.gcode',
            progress: Math.min(0.99, k / (sc.couches + 20)),
            printDuration: at / 1000,
            totalDuration: at / 1000,
            bed: 60,
            bedTarget: 60,
            extruder: 210,
            extruderTarget: 210,
          },
        },
        vision: { probleme: r.probleme, doute: r.doute, incidents: r.incidents },
      });
      etatSurv = s.state;
      surv = s.actions;
      for (const a of surv) {
        if (a.kind === 'pause') {
          res.pauses.push({ couche: k, reason: a.reason });
          enPause = true;
        }
        if (a.kind === 'say' && (a.level === 'doute' || a.level === 'alerte')) res.dits.push({ couche: k, level: a.level, text: a.text });
      }
    }
    res.journal.push({ couche: k, at, objets: r.actions, surveillance: surv, probleme: r.probleme, doute: r.doute });
  }
  res.etatObjets = etatObjets;
  res.etatSurveillance = etatSurv;
  return res;
}

// --- Scénarios pendant l'impression ---------------------------------------------------------------

const FILS_NORMAUX: [Point3, Point3][] = [
  [[80, 135, 6], [135, 135, 7]],
  [[165, 128, 9], [220, 140, 10]],
];

export const SCENARIOS_PENDANT: Record<string, ScenarioImpression> = {
  normale: {
    objets: TROIS,
    couches: 45,
    scene: (k, z) => ({
      blocs: blocsNormaux(TROIS, z),
      filsFins: k > 5 ? FILS_NORMAUX : [],
      lumiere: 8 * Math.sin(k / 6) + (k === 23 ? 40 : 0),
      degrade: k >= 30 ? 20 : 0,
    }),
  },
  spaghetti_un_objet: {
    objets: TROIS,
    couches: 30,
    scene: (k, z, arretes) => {
      const fin = Math.min(k, arretes.get(TROIS[1]!.nom) ?? k);
      return {
        blocs: blocsNormaux(TROIS, z).map((b, i) => (i === 1 ? { ...b, z1: Math.min(b.z1, 15 * COUCHE) } : b)),
        brins: k >= 15 ? [{ centre: [150, 135, 0], rayon: 20, n: (fin - 14) * 4, graine: 3, hauteur: 6 }] : [],
      };
    },
  },
  objet_decolle: {
    objets: TROIS,
    couches: 30,
    scene: (k, z, arretes) => {
      const blocs = blocsNormaux(TROIS, z);
      const fin = Math.min(k, arretes.get(TROIS[2]!.nom) ?? k);
      if (k >= 15) blocs[2] = { polygone: decaler(TROIS[2]!.polygone, 22, -12), z0: 0, z1: 15 * COUCHE };
      return { blocs, brins: k >= 16 ? [{ centre: [235, 135, 0], rayon: 8, n: (fin - 15) * 2, graine: 5, hauteur: 2 }] : [] };
    },
  },
  spaghetti_seul_objet: {
    objets: [TROIS[1]!],
    couches: 30,
    scene: (k, z) => ({
      blocs: blocsNormaux([TROIS[1]!], Math.min(z, 15 * COUCHE)),
      brins: k >= 15 ? [{ centre: [150, 135, 0], rayon: 20, n: (k - 14) * 4, graine: 3, hauteur: 6 }] : [],
    }),
  },
  decalage_couche: {
    objets: TROIS,
    couches: 35,
    scene: (k, z) => {
      const zs = 15 * COUCHE;
      if (k < 15) return { blocs: blocsNormaux(TROIS, z) };
      return {
        blocs: TROIS.flatMap((o) => [
          { polygone: o.polygone, z0: 0, z1: zs },
          { polygone: decaler(o.polygone, 10, 0), z0: zs, z1: Math.min(o.hauteur, z) },
        ]),
      };
    },
  },
  plateau_bouge: {
    objets: TROIS,
    couches: 35,
    scene: (k, z) => {
      if (k < 15) return { blocs: blocsNormaux(TROIS, z) };
      return { decalageFeuille: [8, 0], blocs: TROIS.map((o) => ({ polygone: decaler(o.polygone, 8, 0), z0: 0, z1: Math.min(o.hauteur, z) })) };
    },
  },
  buse_bouchee: {
    objets: TROIS,
    couches: 45,
    scene: (_k, z) => ({ blocs: blocsNormaux(TROIS, Math.min(z, 15 * COUCHE)) }),
  },
  camera_bougee: {
    objets: TROIS,
    couches: 25,
    scene: (k, z) => ({ blocs: blocsNormaux(TROIS, z), camera: k >= 12 ? cameraVraie([6, 0, 4]) : undefined }),
  },
};

// --- G-code de test (format OrcaSlicer pour Klipper) ---------------------------------------------

export interface PieceGcode {
  nom: string;
  /** Morceaux : un rectangle de z0 à z1 (une pièce peut avoir plusieurs morceaux). */
  morceaux: { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number }[];
  /** Un cercle (arcs G2) au lieu d'un rectangle. */
  cercle?: { cx: number; cy: number; r: number; z1: number };
}

/** Écrit un G-code : périmètres et remplissage par couches de 0,2 mm, extrusion relative (M83). */
export function ecrireGcode(pieces: PieceGcode[], options: { purge?: boolean } = {}): string {
  const h = 0.2;
  const lignes: string[] = ['; généré pour les essais', 'G90', 'M83', 'G28'];
  for (const p of pieces) {
    const pts = p.cercle
      ? [[p.cercle.cx - p.cercle.r, p.cercle.cy - p.cercle.r], [p.cercle.cx + p.cercle.r, p.cercle.cy - p.cercle.r], [p.cercle.cx + p.cercle.r, p.cercle.cy + p.cercle.r], [p.cercle.cx - p.cercle.r, p.cercle.cy + p.cercle.r]]
      : p.morceaux.flatMap((m) => [[m.x0, m.y0], [m.x1, m.y0], [m.x1, m.y1], [m.x0, m.y1]]);
    lignes.push(`EXCLUDE_OBJECT_DEFINE NAME=${p.nom} CENTER=0,0 POLYGON=${JSON.stringify(pts)}`);
  }
  if (options.purge) lignes.push('G1 X0.5 Y20 Z0.3 F3000', 'G1 X0.5 Y200 E15 F1500');
  const zMax = Math.max(...pieces.map((p) => (p.cercle ? p.cercle.z1 : Math.max(...p.morceaux.map((m) => m.z1)))));
  for (let z = h; z <= zMax + 1e-6; z += h) {
    const zz = Math.round(z * 100) / 100;
    lignes.push(`;LAYER_CHANGE`, `G1 Z${zz} F600`);
    for (const p of pieces) {
      const tracer: string[] = [];
      if (p.cercle && zz <= p.cercle.z1 + 1e-6) {
        const { cx, cy, r } = p.cercle;
        tracer.push(`G1 X${cx + r} Y${cy} F6000`, `G2 X${cx - r} Y${cy} I${-r} J0 E${(Math.PI * r * 0.05).toFixed(4)}`, `G2 X${cx + r} Y${cy} I${r} J0 E${(Math.PI * r * 0.05).toFixed(4)}`);
      }
      for (const m of p.morceaux) {
        if (zz < m.z0 + h - 1e-6 || zz > m.z1 + 1e-6) continue;
        tracer.push(`G1 X${m.x0} Y${m.y0} F6000`);
        tracer.push(`G1 X${m.x1} Y${m.y0} E1`, `G1 X${m.x1} Y${m.y1} E1`, `G1 X${m.x0} Y${m.y1} E1`, `G1 X${m.x0} Y${m.y0} E1`);
        for (let y = m.y0 + 1; y < m.y1; y += 2) tracer.push(`G1 X${m.x0 + 0.5} Y${y} F6000`, `G1 X${m.x1 - 0.5} Y${y} E0.5`);
      }
      if (tracer.length) lignes.push(`EXCLUDE_OBJECT_START NAME=${p.nom}`, ...tracer, `EXCLUDE_OBJECT_END NAME=${p.nom}`);
    }
  }
  lignes.push('M104 S0', 'M140 S0');
  return lignes.join('\n');
}

export function piece(nom: string, x0: number, y0: number, x1: number, y1: number, z1: number, z0 = 0): PieceGcode {
  return { nom, morceaux: [{ x0, y0, x1, y1, z0, z1 }] };
}
