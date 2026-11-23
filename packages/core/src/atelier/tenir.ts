/**
 * Atelier 3D : les manières de tenir un composant, reprises de `reference/sources/hub.py` (mission
 * des boîtiers) :
 *
 * - **plots et vis** pour une carte (`poserCarte`, dans `composants.ts`) ;
 * - **logement et rebord, avec des retenues souples**, pour un écran dont l'épaisseur au bord n'est
 *   pas sûre (`retenue`, `flexionRetenue`) ;
 * - **chariot réglable** pour une caméra dont l'objectif n'est pas à une place sûre (`chariot`),
 *   derrière une fenêtre évasée, avec un **cache coulissant** et son **bouton** (`volet`, `bouton`),
 *   et le contrôle du champ de vision (`champCamera`).
 *
 * Chaque pièce est écrite dans son repère d'impression, comme dans la référence. Les cotes des
 * composants viennent de `composantsDonnees.ts` ; les autres nombres sont les choix de dessin de la
 * référence, nommés comme dans `hub.py`. Pur : aucune dépendance.
 */
import { DONNEES_COMPOSANTS } from './composantsDonnees.js';
import { boite, cyl, diff, miroir, tronc, union, type Forme } from './csg.js';
import { AVANT_TROU, VIS_M3_PASSAGE } from './visserie.js';

const C = DONNEES_COMPOSANTS.composants;
const R = DONNEES_COMPOSANTS.regles_de_dessin;

// ---------------------------------------------------------------------------------------------
// Écran : retenue souple (une lame de PETG vissée sur un bossage, un patin sur le bord de la vitre)

/** Choix de dessin de la référence (`hub.py`). */
export const RETENUE = {
  bras: 28,
  largeur: 6,
  epaisseur: 2.4,
  /** Le patin recouvre le bord de la vitre de 4 mm. */
  recouvrement: 4,
  /** Bossage de la façade sous la retenue (u × v) ; la lame est tenue à son bord (5 mm du centre). */
  bossage: [10, 8] as const,
  /** Bord de la vitre depuis le centre du bossage : 4,8 + le jeu du logement. */
  bordVitre: 4.8 + R.jeu_logement_ecran,
  /** La bosse du patin (0,8 mm) touche sans effort un écran de cette épaisseur au bord (mm). */
  contactSansEffort: C.touch_display_2_7.epaisseur_au_bord.plage_a_accepter[0],
} as const;

/** La retenue, à plat : bossage percé en (0, 0), bras le long de +x, patin vers +y, z = 0 côté écran. */
export function retenue(): Forme {
  const { bras: L, largeur: l, epaisseur: e, recouvrement } = RETENUE;
  const g = RETENUE.bordVitre;
  const base = boite(-5, L + 3, -l / 2, l / 2, 0, e, 1.5);
  const patin = boite(L - 3, L + 3, -l / 2, g + recouvrement, 0, e, 1.5);
  const bosse = boite(L - 2, L + 2, g + 1, g + recouvrement - 0.3, -0.8, 0.01, 0.8);
  return diff(union(base, patin, bosse), cyl(0, 0, -1, e + 1, VIS_M3_PASSAGE / 2), cyl(3.2, 0, -1, e + 1, 1.35));
}

/**
 * Flexion d'une retenue pour un écran épais de `bord` mm au bord : flèche (mm), effort (N),
 * allongement de la fibre la plus tirée (%). Formules de `composants.json` (lame en porte-à-faux,
 * PETG) : F = 3 E I f / L³ ; e = 3 t f / (2 L²), L de l'appui (bord du bossage) à la bosse.
 */
export function flexionRetenue(bord: number): { fleche: number; effort: number; allongement: number } {
  const lame = R.lame_souple_PETG;
  const L = RETENUE.bras - RETENUE.bossage[0] / 2;
  const t = RETENUE.epaisseur;
  const I = (RETENUE.largeur * t ** 3) / 12;
  const f = Math.max(0, bord - RETENUE.contactSansEffort);
  return { fleche: f, effort: (3 * lame.module_MPa * I * f) / L ** 3, allongement: ((3 * t * f) / (2 * L ** 2)) * 100 };
}

/** Allongement le plus grand accepté pour une lame de PETG (%). */
export const ALLONGEMENT_MAX = R.lame_souple_PETG.allongement_maxi_pct;

// ---------------------------------------------------------------------------------------------
// Caméra : fenêtre, cache coulissant, bouton, chariot

const CAM = C.camera_module_3_wide;

/** Choix de dessin de la référence (`hub.py`), en profondeur w depuis la face avant. */
export const CAMERA = {
  peauCam: 1.2,
  voletEp: 1.6,
  /**
   * Fenêtre de la façade : dedans (w = peauCam) et dehors (w = 0), largeur × hauteur × rayon.
   * Écart voulu avec la référence (14 mm de large dedans et au trou du cache) : avec 14 mm, les
   * coins de l'image à 120° touchent le bord quand l'objectif est décalé de ±0,5 mm (2 rayons sur
   * 240). La référence ne l'essayait qu'objectif centré ; la mission demande ±0,5 mm. 15 mm passe.
   */
  fenetreDedans: [15, 13, 3] as const,
  fenetreDehors: [18.5, 15, 3.5] as const,
  voletTrou: [15, 13, 3] as const,
  voletLongueur: 34,
  voletSTrou: 8,
  voletSPlein: 25,
  voletSVis: 16.5,
  voletBas: -8,
  voletHaut: 14,
  vVisVolet: 11.5,
  boutTete: [5, 1.8] as const,
  boutTige: 2.9,
  wBoutTete: 0.25,
  plotCam: 3,
  chariotEp: 2.5,
  reglage: 5,
  uBossages: 30,
  chariotU: 39,
  chariotV: 13.5,
  /** Position supposée de l'objectif depuis le bord haut de la carte (sources 5,75 à 13,4). */
  objectifB: 9.5,
} as const;

const wVolet0 = CAMERA.peauCam + 0.1;
const wVolet1 = wVolet0 + CAMERA.voletEp;
/** Avant de l'objectif (profondeur depuis la face avant). */
export const W_OBJECTIF = wVolet1 + 0.3;
const wDosCarte = W_OBJECTIF + CAM.hauteur_totale.wide;
const wChariot0 = wDosCarte + CAMERA.plotCam;
const wChariot1 = wChariot0 + CAMERA.chariotEp;

/** Le cache coulissant, à plat : x de 0 à 34 le long de la course, y par rapport à l'objectif, z = 0 côté face avant. */
export function volet(): Forme {
  const k = CAMERA;
  const plaque = boite(0, k.voletLongueur, k.voletBas, k.voletHaut, 0, k.voletEp, 1.5);
  const [l, h, r] = k.voletTrou;
  const trou = tronc(k.voletSTrou, 0, -0.01, k.voletEp + 0.01, l, h, r, l, h, r);
  return diff(plaque, trou, cyl(k.voletSVis, k.vVisVolet, -1, k.voletEp + 1, 1.1));
}

/** Le bouton du cache : tête devant la façade, tige dans la fente, vissé par l'arrière (M2 × 4). */
export function bouton(): Forme {
  const k = CAMERA;
  const tete = cyl(0, 0, k.wBoutTete - k.boutTete[1], k.wBoutTete, k.boutTete[0] / 2);
  const tige = cyl(0, 0, k.wBoutTete - 0.01, wVolet0, k.boutTige / 2);
  return diff(union(tete, tige), cyl(0, 0, k.wBoutTete - k.boutTete[1] + 0.4, wVolet0 + 1, AVANT_TROU.M2 / 2));
}

/** Trous de la caméra sur sa carte : (b, a), b depuis le bord haut, a le long de la carte. */
export const TROUS_CAMERA: [number, number][] = CAM.trous.positions_b_depuis_bord_haut.flatMap((b) => CAM.trous.positions_a.map((a) => [b, a] as [number, number]));

/** Le chariot de la caméra, objectif au centre (u = 0, v = 0), z = profondeur depuis la face avant. */
export function chariot(): Forme {
  const k = CAMERA;
  const u0 = -k.objectifB;
  const plaque = boite(-k.chariotU, k.chariotU, -k.chariotV, k.chariotV, wChariot0, wChariot1, 2);
  const plots: Forme[] = [];
  const trous: Forme[] = [];
  for (const [b, a] of TROUS_CAMERA) {
    const u = u0 + b;
    const v = -CAM.carte.a / 2 + a;
    plots.push(cyl(u, v, wDosCarte, wChariot0 + 0.01, 2.25));
    trous.push(cyl(u, v, wDosCarte - 1, wChariot1 + 1, AVANT_TROU.M2 / 2));
  }
  for (const s of [-1, 1]) {
    trous.push(boite(s * k.uBossages - k.reglage - 1.7, s * k.uBossages + k.reglage + 1.7, 3 - 1.7, 3 + 1.7, wChariot0 - 1, wChariot1 + 1, 1.69));
  }
  trous.push(boite(u0 + CAM.carte.b + 0.8, u0 + CAM.carte.b + 6, -9.5, 9.5, wChariot0 - 1, wChariot1 + 1, 1.5));
  return diff(union(plaque, ...plots), ...trous);
}

/** Positions de l'objectif couvertes par le réglage du chariot (depuis le bord haut de la carte). */
export function reglageChariot(): [number, number] {
  return [CAMERA.objectifB - CAMERA.reglage, CAMERA.objectifB + CAMERA.reglage];
}

export interface FenetreCamera {
  nom: string;
  /** Distance devant l'avant de l'objectif (mm). */
  d: number;
  largeur: number;
  hauteur: number;
  rayon: number;
}

/** Les fenêtres devant l'objectif du hub de la référence, cache ouvert. */
export function fenetresCameraHub(): FenetreCamera[] {
  const k = CAMERA;
  const [li, hi, ri] = k.fenetreDedans;
  const [le, he, re] = k.fenetreDehors;
  const [lv, hv, rv] = k.voletTrou;
  return [
    { nom: 'fenêtre de la façade, dehors', d: W_OBJECTIF, largeur: le, hauteur: he, rayon: re },
    { nom: 'fenêtre de la façade, dedans', d: W_OBJECTIF - k.peauCam, largeur: li, hauteur: hi, rayon: ri },
    { nom: 'trou du cache, devant', d: W_OBJECTIF - wVolet0, largeur: lv, hauteur: hv, rayon: rv },
    { nom: 'trou du cache, derrière', d: W_OBJECTIF - wVolet1, largeur: lv, hauteur: hv, rayon: rv },
  ];
}

/** Le point (x, y) est-il dans le rectangle arrondi l × h (rayon r) centré en 0 ? */
function dansRectArrondi(x: number, y: number, l: number, h: number, r: number): boolean {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > l / 2 || ay > h / 2) return false;
  const cx = l / 2 - r;
  const cy = h / 2 - r;
  return ax <= cx || ay <= cy || Math.hypot(ax - cx, ay - cy) <= r;
}

/** Rayon de l'objectif, marge comprise (`composants.json`, `objectif.rayon_utile`). */
export const RAYON_OBJECTIF = CAM.objectif.rayon_utile;

export interface ChampCamera {
  ok: boolean;
  rayons: number;
  bloques: number;
  /** Ce qui coupe le champ (fenêtre et direction), sans doublon. */
  coupe: string[];
}

/**
 * Le champ de vision passe-t-il par les fenêtres ? Même méthode que le banc de la référence
 * (`banc_hub.py`, section caméra) : des rayons partent de tout le disque de l'objectif (rayon
 * `rayon_utile`), décalé de `decalage` mm le long de l'horizontale (réglage du chariot), vers le
 * bord du champ :
 * - `champ` : l'ellipse des demi-angles horizontal et vertical (72 directions) ;
 * - `coins` : les quatre coins de l'image (format 4:3) à la demi-diagonale (60° pour le grand angle).
 * Une fenêtre est un rectangle arrondi à une distance d devant l'objectif ; entre deux fenêtres d'un
 * même tronc, le rayon reste dedans s'il l'est aux deux bouts (forme convexe).
 */
export function champCamera(fenetres: readonly FenetreCamera[], decalage = 0, quoi: 'champ' | 'coins' = 'champ', objectif: 'wide' | 'standard' = 'wide'): ChampCamera {
  const champ = CAM.champ[objectif];
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const directions: { nom: string; dx: number; dy: number }[] = [];
  if (quoi === 'champ') {
    for (let i = 0; i < 72; i += 1) {
      const ang = (2 * Math.PI * i) / 72;
      const ah = (champ.horizontal / 2) * Math.cos(ang);
      const av = (champ.vertical / 2) * Math.sin(ang);
      const nom = Math.abs(av) < 1e-9 ? (ah < 0 ? 'à gauche' : 'à droite') : Math.abs(ah) < 1e-9 ? (av < 0 ? 'en bas' : 'en haut') : 'vers un coin';
      directions.push({ nom, dx: Math.tan(rad(ah)), dy: Math.tan(rad(av)) });
    }
  } else {
    const k = Math.tan(rad(champ.diagonale / 2)) / Math.hypot(4, 3);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) directions.push({ nom: 'dans un coin de l’image', dx: sx * 4 * k, dy: sy * 3 * k });
  }
  const anneaux = 5;
  const parAnneau = quoi === 'champ' ? 8 : 12;
  let rayons = 0;
  let bloques = 0;
  const coupe = new Set<string>();
  for (const dir of directions) {
    for (let a = 0; a < anneaux; a += 1) {
      const rr = (RAYON_OBJECTIF * a) / (anneaux - 1);
      for (let p = 0; p < parAnneau; p += 1) {
        const phi = (2 * Math.PI * p) / parAnneau;
        const x0 = decalage + rr * Math.cos(phi);
        const y0 = rr * Math.sin(phi);
        rayons += 1;
        const gene = fenetres.find((f) => !dansRectArrondi(x0 + dir.dx * f.d, y0 + dir.dy * f.d, f.largeur, f.hauteur, f.rayon));
        if (gene) {
          bloques += 1;
          coupe.add(`${gene.nom}, ${dir.nom}`);
        }
      }
    }
  }
  return { ok: bloques === 0, rayons, bloques, coupe: [...coupe] };
}

/**
 * Les pièces des manières de tenir, dans le sens où elles s'impriment sans support (comme les STL
 * de la référence) : la retenue bosse vers le haut, le chariot plaque contre le plateau, le cache à
 * plat, le bouton tête contre le plateau.
 */
export function piecesATenirAImprimer(): { nom: string; titre: string; forme: Forme }[] {
  return [
    { nom: 'retenue', titre: 'retenue souple de l’écran', forme: miroir(retenue(), 'z') },
    { nom: 'cache', titre: 'cache coulissant de la caméra', forme: volet() },
    { nom: 'bouton', titre: 'bouton du cache', forme: bouton() },
    { nom: 'chariot', titre: 'chariot de la caméra', forme: miroir(chariot(), 'z') },
  ];
}
