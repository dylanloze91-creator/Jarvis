/**
 * Atelier 3D : le boîtier à écran (« un boîtier pour un Raspberry Pi 5 avec l'écran tactile
 * 7 pouces et la caméra grand angle »), dessiné seul, par règles.
 *
 * Les règles sont celles du hub de la référence (`reference/sources/hub.py` de la mission des
 * boîtiers), écrites ici presque ligne à ligne :
 * - module écran = façade + dos, incliné de `angle` vers l'arrière, l'écran tenu par un rebord
 *   devant et des retenues souples derrière (`tenir.ts`) ;
 * - caméra au-dessus de l'écran, sur un chariot réglable, derrière une fenêtre évasée, avec un cache
 *   coulissant (facultatif) ;
 * - socle + capot avec sa cale ; la carte dans un coin, ses prises USB face à la paroi choisie
 *   (« à l'arrière » : USB et réseau derrière, alimentation et HDMI à droite ; « sur le côté » :
 *   l'inverse) ;
 * - passage des câbles aligné du socle jusque dans le dos de l'écran ; vis et inserts aux coins.
 *
 * Les cotes des composants viennent de `composantsDonnees.ts` (sources citées), les cotes de dessin
 * de la référence. Aucun modèle d'IA. Les contrôles sont dans `bancBoitierEcran.ts`.
 *
 * Repères (comme la référence) :
 * - monde : x vers la droite (vu de face), y vers l'arrière, z vers le haut ; socle posé sur z = 0 ;
 * - module écran : u = x, v vers le haut le long de l'écran, w vers l'arrière (w = 0 : face avant).
 *
 * Pur : aucune dépendance.
 */
import { DONNEES_COMPOSANTS } from './composantsDonnees.js';
import { boite as rr, cyl, deplacer, diff, miroir, prisme, tournerForme, tronc, union, type Forme } from './csg.js';
import { bouton, CAMERA, chariot, PROFONDEURS_CAMERA, RETENUE, retenue, TROUS_CAMERA, volet } from './tenir.js';
import { AVANT_TROU, INSERT_M3, LONGUEURS_M3, PRISE_MAX, PRISE_MIN, VIS_M3_PASSAGE } from './visserie.js';

const C = DONNEES_COMPOSANTS.composants;
const R = DONNEES_COMPOSANTS.regles_de_dessin;
const PI5 = C.raspberry_pi_5;
const ECR = C.touch_display_2_7;
const CAM = C.camera_module_3_wide;

/** Les choix de l'utilisateur. */
export interface ChoixBoitierEcran {
  /** Inclinaison de l'écran vers l'arrière (degrés). */
  angle: number;
  /** « arriere » : USB et réseau derrière ; « cote » : USB et réseau à droite. */
  ports: 'arriere' | 'cote';
  /** Caméra au-dessus de l'écran. */
  camera: boolean;
  /** Cache coulissant devant la caméra. */
  cache: boolean;
}

/** Les choix du hub de la référence. */
export const CHOIX_HUB: ChoixBoitierEcran = { angle: 15, ports: 'arriere', camera: true, cache: true };

/** Bornes de l'inclinaison : au-delà, l'écran bascule (contrôle de stabilité) ou la cale devient trop haute. */
export const ANGLE_MIN = 0;
export const ANGLE_MAX = 30;

/** Une prise de la carte, et où elle sort du socle. */
export interface PriseBoitier {
  nom: string;
  /** Paroi : « arrière » (y = profondeur du socle) ou « droite » (x = moitié de la largeur). */
  paroi: 'arriere' | 'droite';
  /** Centre de la prise dans le monde (mm). */
  centre: [number, number, number];
  largeur: number;
  hauteur: number;
  /** Prise qui dépasse de la carte (USB, réseau) ou au ras du bord (USB-C, micro-HDMI : paroi amincie). */
  depasse: boolean;
}

export interface PieceBoitier {
  /** Nom de fichier court : `Facade`, `Retenue_A`… */
  nom: string;
  /** Nom dit à l'utilisateur. */
  titre: string;
  nombre: number;
  /** Sens d'impression, en mots simples. */
  sens: string;
  /** La pièce dans son sens d'impression (posée sur z = 0). */
  forme: Forme;
  /** Où va chaque exemplaire monté : matrices 4 × 4 (lignes) du repère d'impression vers le monde. */
  placements: Matrice[];
  /** Déplacement de la pièce dans la vue éclatée (monde, mm). */
  eclate: [number, number, number];
}

/** Matrice 4 × 4 (lignes), pour placer une pièce. */
export type Matrice = number[][];

function produit(a: Matrice, b: Matrice): Matrice {
  return a.map((ligne) => [0, 1, 2, 3].map((j) => ligne.reduce((acc, x, k) => acc + x * b[k]![j]!, 0)));
}
function translation(x: number, y: number, z: number): Matrice {
  return [
    [1, 0, 0, x],
    [0, 1, 0, y],
    [0, 0, 1, z],
    [0, 0, 0, 1],
  ];
}
function echelle(x: number, y: number, z: number): Matrice {
  return [
    [x, 0, 0, 0],
    [0, y, 0, 0],
    [0, 0, z, 0],
    [0, 0, 0, 1],
  ];
}
/** Applique une matrice à un point. */
export function appliquerMatrice(m: Matrice, p: readonly [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((i) => m[i]![0]! * p[0] + m[i]![1]! * p[1] + m[i]![2]! * p[2] + m[i]![3]!) as [number, number, number];
}

// --------------------------------------------------------------------------- cotes de dessin (hub.py)
const JEU = R.jeu_logement_ecran;
const INS_D = INSERT_M3.percage;
const INS_P = INSERT_M3.profondeur;
const M3_PASS = VIS_M3_PASSAGE;
const PAROI = R.paroi;
const PEAU = R.peau_devant_ecran;
const REBORD = R.rebord_sur_vitre;
const BORD_COTE = 6;
const BORD_BAS = 12;
/** Bordure du haut quand il n'y a pas de caméra. */
const BORD_HAUT_SANS_CAMERA = 12;
const R_EXT = 6;
const W_JOINT = 13;
const W_TOT = 27;
const DOS_EP = 2.5;
const NERV = 1.6;
const NERV_W = 7;
const SPIG = { e: 1.2, h: 3, jeu: R.jeu_entre_pieces_emboitees };
const COIN = 6;
const U_BOS_BAS = 48;
const W_BOS_BAS = 19;
const BOS_BAS_H = 10.4;
const PASS_U: [number, number] = [15, 39];
const PASS_W: [number, number] = [14, 22];
const Y0 = 8;
const SOC_P = 120;
const CAP_EP = 2.5;
const SOC_FOND = 2.4;
const H_CALE_AR = 9.6;
/** La cale sous le module : de y = 10 à y = 32, ou 2 mm avant l'arrière du module s'il finit plus tôt (écran très incliné). */
const CALE_Y0 = 10;
const CALE_Y1 = 32;
const CALE_U = 65;
const PLOT_PI = 5;
/** Jeu entre la carte et la paroi où ses prises sont au ras (USB-C, micro-HDMI) et où elles dépassent (USB, réseau). */
const JEU_PI_RAS = 0.5;
const JEU_PI_DEPASSE = 1.5;
const JEU_PORT = R.jeu_prise;
/** Air au-dessus du ventilateur de la carte, sous le capot. */
const AIR_VENTILATEUR = 6.1;
/** Creux de la paroi devant les prises au ras du bord (paroi restante : `paroi_amincie_devant_prises_laterales`). */
const CREUX_PAROI = PAROI - R.paroi_amincie_devant_prises_laterales;
/** Un bossage du socle déplacé le long de la paroi s'arrête à cette distance de la carte. */
const DEGAGEMENT_BOSSAGE_CARTE = 7.5;
// Retenues de l'écran : (u, sens du bras ±1 en u, côté de la vitre ±1 en v), bossages 10 × 8
const RET_U: [number, number, number][] = [
  [-56, -1, +1],
  [56, +1, +1],
  [-85, +1, -1],
  [85, -1, -1],
];
const W_RET = PEAU + RETENUE.contactSansEffort + 0.8;
// Caméra
const K = CAMERA;
const PW = PROFONDEURS_CAMERA;
const W_RAIL = 3.4;
const RAIL = 2;
const U_RAIL: [number, number] = [-36, 36];
const FENTE_H = 3.2;
const PISTE: [number, number] = [0.4, 5.6];
/** Bossage du chariot : 3 mm au-dessus de l'objectif. */
const V_BOS_CAM = 3;

/** Le boîtier dessiné : toutes ses cotes, ses pièces, ses composants et ses prises. */
export interface BoitierEcran {
  choix: ChoixBoitierEcran;
  /** Cotes dérivées (mêmes noms que `hub.py`). */
  c: ReturnType<typeof cotes>;
  /** Pièces dans le repère du module (façade, dos, cache, bouton, chariot, retenues) ou du monde (socle, capot). */
  facade(): Forme;
  dos(): Forme;
  socle(): Forme;
  capot(): Forme;
  /** Les pièces assemblées, dans le monde. `cache` : ouvert ou fermé ; `decalCam` : réglage du chariot. */
  assemblage(o?: { cache?: 'ouvert' | 'ferme'; decalCam?: number }): Record<string, Forme>;
  /** Les pièces du module seules, dans le repère du module. */
  piecesModule(o?: { cache?: 'ouvert' | 'ferme'; decalCam?: number }): Record<string, Forme>;
  /** Composants (formes prudentes), dans le repère du module (écran, caméra) ou du monde (carte). */
  ecran(bord?: number): Forme;
  cameraModule(decal?: number): Forme;
  carte(): Forme;
  /** Cache et bouton placés, repère du module. */
  voletPlace(etat: 'ouvert' | 'ferme'): Forme;
  /** Du repère du module vers le monde. */
  versMonde(f: Forme): Forme;
  point(u: number, v: number, w: number): [number, number, number];
  /** Hauteur du dessous du module à l'abscisse y du monde. */
  zBasModule(y: number): number;
  /** Axe d'une vis capot → module (point sur le dessous du module, direction). */
  axeVisModule(s: number): { p: [number, number, number]; d: [number, number, number] };
  prises: PriseBoitier[];
  /** Les pièces à imprimer, chacune dans son sens. */
  pieces(): PieceBoitier[];
  /** Encombrement du boîtier monté (largeur, profondeur, hauteur). */
  encombrement: [number, number, number];
  /** Le boîtier monté, en OpenSCAD (pièces seulement), pour l'ouvrir sur le PC. */
  scadAssemblage(): string;
}

function cotes(choix: ChoixBoitierEcran) {
  const ECR_L = ECR.contour.longueur;
  const ECR_H = ECR.contour.hauteur;
  const LOG_U = ECR_L + 2 * JEU;
  const LOG_V = ECR_H + 2 * JEU;
  const FW = LOG_U + 2 * BORD_COTE;
  const vLog0 = BORD_BAS;
  const vLog1 = BORD_BAS + LOG_V;
  const uLog = LOG_U / 2;
  const vVit0 = vLog0 + JEU;
  const vVit1 = vLog1 - JEU;
  const uVit = ECR_L / 2;
  // Objectif : au-dessus du cadre de l'écran, le cache (8 mm sous l'objectif) et son rail en dessous.
  const vCam = vLog1 + NERV + 0.2 + RAIL + 0.3 - K.voletBas;
  const FH = choix.camera ? vCam + K.voletHaut + 0.3 + PAROI : vLog1 + BORD_HAUT_SANS_CAMERA;
  const vRailBas: [number, number] = [vCam + K.voletBas - 0.3 - RAIL, vCam + K.voletBas - 0.3];
  const vRailHaut: [number, number] = [vCam + K.voletHaut + 0.3, FH - PAROI];
  const vRetBas = vLog0 - 4.8;
  const vRetHaut = vLog1 + 4.8;
  const RET = RET_U.map(([u, su, cv]) => ({ u, v: cv > 0 ? vRetBas : vRetHaut, su, cv }));
  const coinsMod: [number, number][] = [];
  for (const sx of [-1, 1]) for (const v of [COIN, FH - COIN]) coinsMod.push([sx * (FW / 2 - COIN), v]);
  const theta = choix.angle;
  const st = Math.sin((theta * Math.PI) / 180);
  const ct = Math.cos((theta * Math.PI) / 180);
  // Socle : le capot au-dessus du ventilateur de la carte, avec de l'air.
  const zPcb0 = SOC_FOND + PLOT_PI;
  const zPcb1 = zPcb0 + PI5.carte.epaisseur;
  const SOC_H = Math.ceil(zPcb1 + PI5.ventilateur_officiel.enveloppe_prudente.hauteur + AIR_VENTILATEUR + CAP_EP - 1e-6);
  const zCap0 = SOC_H - CAP_EP;
  // L'arrière du dessous du module est à H_CALE_AR au-dessus du capot, au bout de la cale.
  const CALE_Y: [number, number] = [CALE_Y0, Math.min(CALE_Y1, Y0 + W_TOT * ct - 2)];
  const Z0 = SOC_H + H_CALE_AR + ((CALE_Y[1] - Y0) * st) / ct;
  const lamageCapot = lamage((Z0 - W_BOS_BAS * st - zCap0) / ct);
  return {
    ECR_L, ECR_H, LOG_U, LOG_V, FW, vLog0, vLog1, uLog, vVit0, vVit1, uVit, vCam, FH, vRailBas, vRailHaut, RET, coinsMod,
    theta, st, ct, zPcb0, zPcb1, SOC_H, zCap0, Z0, SOC_P, Y0, PAROI, PEAU, W_TOT, W_JOINT, DOS_EP, W_RET, JEU, REBORD, CAP_EP,
    PASS_U, PASS_W, CALE_Y, U_BOS_BAS, W_BOS_BAS, INS_P, INS_D, PLOT_PI, JEU_PORT, CREUX_PAROI, JEU_PI_RAS, lamageCapot,
  };
}

/** Profondeur ordinaire du lamage d'une vis M3 (logement de la tête). */
const LAMAGE = 3;
/** Plastique gardé au moins sous la tête d'une vis lamée. */
const SOUS_TETE_MIN = 4;

/**
 * Profondeur du lamage d'une vis qui traverse `longueur` mm de plastique avant l'insert : 3 mm si une
 * vis de la liste courante prend bien ainsi, sinon le lamage est creusé plus profond pour qu'une vis
 * plus courte prenne (la règle « allonger la vis » de la mission, à l'envers : la vis reste courante).
 */
function lamage(longueur: number): number {
  for (const L of [...LONGUEURS_M3].reverse()) {
    const lam = Math.max(LAMAGE, longueur - L + (PRISE_MIN + PRISE_MAX) / 2 - 0.1);
    const prise = L - (longueur - lam);
    if (prise >= PRISE_MIN && prise <= PRISE_MAX && longueur - lam >= SOUS_TETE_MIN) return lam;
  }
  return LAMAGE;
}

/** Une carte Raspberry Pi 5 placée : repère de la carte (px, py) → monde, et ses bords. */
function placementCarte(c: ReturnType<typeof cotes>, ports: ChoixBoitierEcran['ports']) {
  const L = PI5.carte.longueur;
  const W = PI5.carte.largeur;
  if (ports === 'arriere') {
    // Bord USB face à l'arrière, bord USB-C face à la droite, dans le coin arrière droit.
    const x1 = c.FW / 2 - PAROI - JEU_PI_RAS;
    const y1 = SOC_P - PAROI - JEU_PI_DEPASSE;
    const y0 = y1 - L;
    const x0 = x1 - W;
    return {
      rect: [x0, x1, y0, y1] as [number, number, number, number],
      xy: (px: number, py: number): [number, number] => [x1 - py, y0 + px],
      // rectangle du repère de la carte → monde
      boite: (px0: number, px1: number, py0: number, py1: number): [number, number, number, number] => [x1 - py1, x1 - py0, y0 + px0, y0 + px1],
      paroiUsb: 'arriere' as const,
      paroiUsbc: 'droite' as const,
      bordUsb: y1,
      bordUsbc: x1,
    };
  }
  // « sur le côté » : bord USB face à la droite, bord USB-C face à l'arrière.
  const x1 = c.FW / 2 - PAROI - JEU_PI_DEPASSE;
  const x0 = x1 - L;
  const y1 = SOC_P - PAROI - JEU_PI_RAS;
  const y0 = y1 - W;
  return {
    rect: [x0, x1, y0, y1] as [number, number, number, number],
    xy: (px: number, py: number): [number, number] => [x0 + px, y1 - py],
    boite: (px0: number, px1: number, py0: number, py1: number): [number, number, number, number] => [x0 + px0, x0 + px1, y1 - py1, y1 - py0],
    paroiUsb: 'droite' as const,
    paroiUsbc: 'arriere' as const,
    bordUsb: x1,
    bordUsbc: y1,
  };
}

/** Dessine le boîtier à écran pour ces choix. Lève une erreur si un choix sort des bornes. */
export function dessinerBoitierEcran(choix: ChoixBoitierEcran = CHOIX_HUB): BoitierEcran {
  if (!(choix.angle >= ANGLE_MIN && choix.angle <= ANGLE_MAX)) throw new Error(`L’inclinaison de l’écran va de ${ANGLE_MIN} à ${ANGLE_MAX}°.`);
  const ch: ChoixBoitierEcran = { ...choix, cache: choix.camera && choix.cache };
  const c = cotes(ch);
  const { FW, FH, st, ct, Z0, zCap0, SOC_H, zPcb0, zPcb1 } = c;
  const pi = placementCarte(c, ch.ports);
  const [piX0, piX1, piY0, piY1] = pi.rect;

  // ----------------------------------------------------------------- prises de la carte
  const zc = zPcb1 + 1.6;
  const prises: PriseBoitier[] = [];
  for (const p of PI5.prises_bord_usb) {
    const [x, y] = pi.xy(PI5.carte.longueur, p.py_centre);
    const nom = p.nom.startsWith('USB') ? `USB ${prises.filter((q) => q.nom.startsWith('USB ')).length + 1}` : p.nom;
    prises.push({ nom, paroi: pi.paroiUsb, centre: [x, y, zPcb1 + p.hauteur / 2], largeur: p.largeur, hauteur: p.hauteur, depasse: true });
  }
  for (const p of PI5.prises_bord_usbc) {
    const [x, y] = pi.xy(p.px_centre, 0);
    const nom = p.nom.replace(' alimentation', '');
    prises.push({ nom, paroi: pi.paroiUsbc, centre: [x, y, zc], largeur: p.largeur, hauteur: p.hauteur, depasse: false });
  }
  /** Position le long de la paroi (x pour l'arrière, y pour la droite). */
  const le = (p: PriseBoitier) => (p.paroi === 'arriere' ? p.centre[0] : p.centre[1]);

  // Trous de la carte (repère de la carte : 3,5 mm des bords, entraxe 58 × 49).
  const t = PI5.trous;
  const trousPi = [t.depuis_bord_carte_sd, t.depuis_bord_carte_sd + t.entraxe[0]].flatMap((px) =>
    [t.depuis_bords_longs, t.depuis_bords_longs + t.entraxe[1]].map((py) => pi.xy(px, py)),
  );

  // Vis capot → socle : aux coins, déplacées le long de la paroi si la carte y est.
  const visSoc: [number, number][] = [];
  for (const sx of [-1, 1]) {
    for (const yc of [7, SOC_P - 7]) {
      let x = sx * (FW / 2 - 7);
      let y = yc;
      const r = 4.6;
      const gene = x + r > piX0 && x - r < piX1 && y + r > piY0 && y - r < piY1;
      if (gene) {
        // le long de la paroi avant/arrière (en x) ou de la paroi gauche/droite (en y) : le plus court
        const nx = sx > 0 ? piX0 - r - DEGAGEMENT_BOSSAGE_CARTE : piX1 + r + DEGAGEMENT_BOSSAGE_CARTE;
        const ny = yc > SOC_P / 2 ? piY0 - r - DEGAGEMENT_BOSSAGE_CARTE : piY1 + r + DEGAGEMENT_BOSSAGE_CARTE;
        if (Math.abs(nx - x) <= Math.abs(ny - y)) x = nx;
        else y = ny;
      }
      visSoc.push([x, y]);
    }
  }

  // ----------------------------------------------------------------- outils
  const insertW = (u: number, v: number, wHaut: number, prof = INS_P) => cyl(u, v, wHaut - prof, wHaut + 0.01, INS_D / 2);
  // Cylindre d'axe v (repère du module) : point (u, -w, v) → (u, v, w)
  const cylAxeV = (u: number, w: number, v0: number, v1: number, r: number) => tournerForme(cyl(u, -w, v0, v1, r), 'x', -90);
  const prismeX = (prof: [number, number][], x0: number, x1: number) => tournerForme(tournerForme(prisme(prof, x0, x1), 'x', 90), 'z', 90);
  const cylAxe = (p0: [number, number, number], d: [number, number, number], L: number, r: number) => {
    const ang = (Math.atan2(-d[1], d[2]) * 180) / Math.PI;
    return deplacer(tournerForme(cyl(0, 0, 0, L, r), 'x', ang), p0);
  };
  const zBasModule = (y: number) => Z0 - ((y - Y0) * st) / ct;
  const point = (u: number, v: number, w: number): [number, number, number] => [u, Y0 + v * st + w * ct, Z0 + v * ct - w * st];
  const versMonde = (f: Forme) => deplacer(tournerForme(miroir(tournerForme(f, 'x', 90), 'y'), 'x', -c.theta), [0, Y0, Z0]);
  const axeVisModule = (s: number) => ({
    p: [s * U_BOS_BAS, Y0 + W_BOS_BAS * ct, Z0 - W_BOS_BAS * st] as [number, number, number],
    d: [0, -st, -ct] as [number, number, number],
  });

  // ----------------------------------------------------------------- façade
  const facade = (): Forme => {
    const coque = rr(-FW / 2, FW / 2, 0, FH, 0, W_JOINT, R_EXT);
    const vide = rr(-FW / 2 + PAROI, FW / 2 - PAROI, PAROI, FH - PAROI, PEAU, W_JOINT + 1, R_EXT - PAROI);
    const chanf = diff(rr(-FW / 2 - 1, FW / 2 + 1, -1, FH + 1, -1, 0.8), tronc(0, FH / 2, 0, 0.8, FW - 1.6, FH - 1.6, R_EXT - 0.8, FW, FH, R_EXT));
    const corps = diff(coque, vide, chanf);
    const ajouts: Forme[] = [];
    ajouts.push(
      diff(
        rr(-c.uLog - NERV, c.uLog + NERV, c.vLog0 - NERV, c.vLog1 + NERV, PEAU - 0.01, NERV_W, 1 + NERV),
        rr(-c.uLog, c.uLog, c.vLog0, c.vLog1, PEAU - 1, NERV_W + 1, 1),
      ),
    );
    for (const [u, v] of c.coinsMod) ajouts.push(cyl(u, v, PEAU - 0.01, W_JOINT, 4));
    for (const { u, v, su } of c.RET) {
      const [bu, bv] = RETENUE.bossage;
      ajouts.push(rr(u - bu / 2, u + bu / 2, v - bv / 2, v + bv / 2, PEAU - 0.01, W_RET, 1.5));
      ajouts.push(cyl(u + su * 3.2, v, W_RET - 0.01, W_RET + 1.2, 1.1));
    }
    if (ch.camera) {
      ajouts.push(rr(U_RAIL[0], U_RAIL[1], c.vRailBas[0], c.vRailBas[1], K.peauCam - 0.01, W_RAIL));
      ajouts.push(rr(U_RAIL[0], U_RAIL[1], c.vRailHaut[0], c.vRailHaut[1] + 0.01, K.peauCam - 0.01, W_RAIL));
      for (const s of [-1, 1]) {
        const u = s * K.uBossages;
        ajouts.push(rr(u - 4.5, u + 4.5, c.vRailBas[0], c.vRailHaut[1], W_RAIL - 0.01, W_RAIL + 2));
        ajouts.push(cyl(u, c.vCam + V_BOS_CAM, W_RAIL + 2 - 0.01, PW.chariot0, 4));
      }
    }
    const piece = union(corps, ...ajouts);
    const trous: Forme[] = [];
    const fu = c.uVit - REBORD;
    const fv0 = c.vVit0 + REBORD;
    const fv1 = c.vVit1 - REBORD;
    const fc = (fv0 + fv1) / 2;
    trous.push(rr(-fu, fu, fv0, fv1, 1.2, PEAU + 0.5, 4));
    trous.push(tronc(0, fc, -0.01, 1.21, 2 * fu + 2.4, fv1 - fv0 + 2.4, 5.2, 2 * fu, fv1 - fv0, 4));
    if (ch.camera) {
      trous.push(rr(-27.5, 28.5, c.vRailBas[1], c.vRailHaut[0], K.peauCam, PEAU + 0.01));
      const [li, hi, ri] = K.fenetreDedans;
      const [lx, hx, rx] = K.fenetreDehors;
      trous.push(tronc(0, c.vCam, -0.01, K.peauCam + 0.01, lx, hx, rx, li, hi, ri));
      if (ch.cache) {
        const dvis = (K.voletSPlein - K.voletSTrou) / 2;
        const hf = FENTE_H / 2;
        const hp = PISTE[1] / 2;
        const vv = c.vCam + K.vVisVolet;
        trous.push(rr(-dvis - hf, dvis + hf, vv - hf, vv + hf, -0.01, K.peauCam + 0.01, hf - 0.01));
        trous.push(rr(-dvis - hp, dvis + hp, vv - hp, vv + hp, -0.01, PISTE[0], hp - 0.01));
      }
      for (const s of [-1, 1]) trous.push(insertW(s * K.uBossages, c.vCam + V_BOS_CAM, PW.chariot0));
    }
    for (const [u, v] of c.coinsMod) trous.push(insertW(u, v, W_JOINT));
    for (const { u, v } of c.RET) trous.push(insertW(u, v, W_RET));
    return diff(piece, ...trous);
  };

  // ----------------------------------------------------------------- dos
  const dos = (): Forme => {
    const coque = rr(-FW / 2, FW / 2, 0, FH, W_JOINT, W_TOT, R_EXT);
    const vide = rr(-FW / 2 + PAROI, FW / 2 - PAROI, PAROI, FH - PAROI, W_JOINT - 1, W_TOT - DOS_EP, R_EXT - PAROI);
    const corps = diff(coque, vide);
    const { e, h, jeu: j } = SPIG;
    const a = -FW / 2 + PAROI + j;
    let anneau = diff(
      rr(a, -a, PAROI + j, FH - PAROI - j, W_JOINT - h, W_JOINT + 0.01, R_EXT - PAROI - j),
      rr(a + e, -a - e, PAROI + j + e, FH - PAROI - j - e, W_JOINT - h - 1, W_JOINT + 1, Math.max(R_EXT - PAROI - j - e, 0.5)),
    );
    // La lèvre est entaillée autour des bossages des coins et des retenues.
    const [bu, bv] = RETENUE.bossage;
    anneau = diff(
      anneau,
      ...c.coinsMod.map(([u, v]) => cyl(u, v, W_JOINT - h - 1, W_JOINT + 1, 4.6)),
      // (toutes les retenues : sans caméra, le module est plus bas et la lèvre passe aussi sur celles du haut)
      ...c.RET.map(({ u, v }) => rr(u - bu / 2 - 0.6, u + bu / 2 + 0.6, v - bv / 2 - 0.6, v + bv / 2 + 0.6, W_JOINT - h - 1, W_JOINT + 1)),
    );
    const ajouts: Forme[] = [anneau];
    for (const [u, v] of c.coinsMod) ajouts.push(cyl(u, v, W_JOINT, W_TOT - 0.01, 4));
    for (const s of [-1, 1]) {
      const u = s * U_BOS_BAS;
      ajouts.push(rr(u - 4.5, u + 4.5, PAROI - 0.01, BOS_BAS_H, W_BOS_BAS - 4.5, W_TOT - DOS_EP + 0.01));
    }
    const piece = union(corps, ...ajouts);
    const trous: Forme[] = [];
    for (const [u, v] of c.coinsMod) {
      trous.push(cyl(u, v, W_JOINT - 1, W_TOT + 1, M3_PASS / 2));
      trous.push(cyl(u, v, W_TOT - 3, W_TOT + 1, 3.25));
    }
    for (const s of [-1, 1]) trous.push(cylAxeV(s * U_BOS_BAS, W_BOS_BAS, -0.01, INS_P, INS_D / 2));
    trous.push(rr(PASS_U[0], PASS_U[1], -1, PAROI + 1, PASS_W[0], PASS_W[1], 2));
    for (let i = 0; i < 9; i += 1) {
      const v = FH / 2 - 40 + i * 10;
      trous.push(rr(-60, 60, v - 1.5, v + 1.5, W_TOT - DOS_EP - 1, W_TOT + 1, 1.49));
    }
    return diff(piece, ...trous);
  };

  // ----------------------------------------------------------------- socle
  const socle = (): Forme => {
    const coque = rr(-FW / 2, FW / 2, 0, SOC_P, 0, SOC_H, R_EXT);
    const vide = rr(-FW / 2 + PAROI, FW / 2 - PAROI, PAROI, SOC_P - PAROI, SOC_FOND, SOC_H + 1, R_EXT - PAROI);
    const corps = diff(coque, vide);
    const aj: Forme[] = [];
    const a = FW / 2 - PAROI;
    aj.push(
      diff(rr(-a, a, PAROI, SOC_P - PAROI, zCap0 - 1.5, zCap0, R_EXT - PAROI), rr(-a + 1.5, a - 1.5, PAROI + 1.5, SOC_P - PAROI - 1.5, zCap0 - 2, zCap0 + 1, 2.1)),
    );
    aj.push(
      diff(
        rr(-a, a, PAROI, SOC_P - PAROI, zCap0 - 3, zCap0 - 1.49, R_EXT - PAROI),
        tronc(0, SOC_P / 2, zCap0 - 3.01, zCap0 - 1.48, 2 * a + 0.02, SOC_P - 2 * PAROI + 0.02, R_EXT - PAROI, 2 * a - 3, SOC_P - 2 * PAROI - 3, 2.1),
      ),
    );
    for (const [x, y] of visSoc) aj.push(cyl(x, y, SOC_FOND - 0.01, zCap0, 4.6));
    for (const [x, y] of trousPi) aj.push(cyl(x, y, SOC_FOND - 0.01, zPcb0, 3));
    const piece = union(corps, ...aj);
    const tr: Forme[] = [];
    for (const [x, y] of visSoc) tr.push(cyl(x, y, zCap0 - INS_P, zCap0 + 0.01, INS_D / 2));
    for (const [x, y] of trousPi) tr.push(cyl(x, y, SOC_FOND + 0.6, zPcb0 + 0.01, AVANT_TROU['M2.5'] / 2));
    // prises qui dépassent : ouverture avec le jeu tout autour
    for (const p of prises.filter((q) => q.depasse)) {
      const t0 = le(p) - p.largeur / 2 - JEU_PORT;
      const t1 = le(p) + p.largeur / 2 + JEU_PORT;
      const z0 = zPcb1 - JEU_PORT;
      const z1 = zPcb1 + p.hauteur + JEU_PORT;
      tr.push(p.paroi === 'arriere' ? rr(t0, t1, SOC_P - PAROI - 1, SOC_P + 1, z0, z1, 1) : rr(FW / 2 - PAROI - 1, FW / 2 + 1, t0, t1, z0, z1, 1));
    }
    // prises au ras du bord : paroi creusée de l'extérieur, puis ouverture (jeu 0,6)
    const ras = prises.filter((q) => !q.depasse);
    if (ras.length) {
      const ts = ras.map(le).sort((x, y) => x - y);
      const t0 = ts[0]! - 7.5;
      const t1 = ts[ts.length - 1]! + 7;
      tr.push(
        ras[0]!.paroi === 'droite'
          ? rr(FW / 2 - CREUX_PAROI, FW / 2 + 1, t0, t1, zc - 6, zc + 6, 2)
          : rr(t0, t1, SOC_P - CREUX_PAROI, SOC_P + 1, zc - 6, zc + 6, 2),
      );
      for (const p of ras) {
        const lo = p.largeur + 1.2;
        const ho = p.hauteur + 1.2;
        tr.push(
          p.paroi === 'droite'
            ? rr(FW / 2 - PAROI - 1, FW / 2 + 1, le(p) - lo / 2, le(p) + lo / 2, zc - ho / 2, zc + ho / 2, 1.2)
            : rr(le(p) - lo / 2, le(p) + lo / 2, SOC_P - PAROI - 1, SOC_P + 1, zc - ho / 2, zc + ho / 2, 1.2),
        );
      }
    }
    // grille arrière, de la gauche jusqu'au premier obstacle (prise ou bossage contre la paroi)
    const obstacles: [number, number][] = [];
    for (const p of prises.filter((q) => q.paroi === 'arriere')) obstacles.push([le(p) - p.largeur / 2 - 7.5 - 3, le(p) + p.largeur / 2 + 7.5 + 3]);
    for (const [x, y] of visSoc) if (y + 4.6 >= SOC_P - PAROI - 0.01) obstacles.push([x - 4.6, x + 4.6]);
    for (let i = 0; ; i += 1) {
      const x = -88 + i * 7;
      if (x + 1.5 > FW / 2 - R_EXT - 4) break;
      if (obstacles.some(([o0, o1]) => x + 1.5 > o0 && x - 1.5 < o1)) break;
      tr.push(rr(x - 1.5, x + 1.5, SOC_P - PAROI - 1, SOC_P + 1, 8, 24, 1.49));
    }
    // aérations du fond, sous la carte (le long de sa longueur)
    for (let i = 0; i < 7; i += 1) {
      const py = 48 - 6.5 * i;
      const [x0, x1, y0, y1] = pi.boite(12, PI5.carte.longueur - 12, py - 1.25, py + 1.25);
      tr.push(rr(x0, x1, y0, y1, -1, SOC_FOND + 1, 1.24));
    }
    for (const x of [-85, 85]) for (const y of [12, SOC_P - 12]) tr.push(cyl(x, y, -0.01, 1, 5.3));
    tr.push(
      diff(rr(-FW / 2 - 1, FW / 2 + 1, -1, SOC_P + 1, -1, 0.6), tronc(0, SOC_P / 2, 0, 0.6, FW - 1.2, SOC_P - 1.2, R_EXT - 0.6, FW, SOC_P, R_EXT)),
    );
    return diff(piece, ...tr);
  };

  // ----------------------------------------------------------------- capot
  const capot = (): Forme => {
    const a = FW / 2 - PAROI - 0.25;
    const plaque = rr(-a, a, PAROI + 0.25, SOC_P - PAROI - 0.25, zCap0, SOC_H, R_EXT - PAROI - 0.25);
    const prof: [number, number][] = [
      [c.CALE_Y[0], SOC_H - 0.01],
      [c.CALE_Y[1], SOC_H - 0.01],
      [c.CALE_Y[1], zBasModule(c.CALE_Y[1])],
      [c.CALE_Y[0], zBasModule(c.CALE_Y[0])],
    ];
    const piece = union(plaque, prismeX(prof, -CALE_U, CALE_U));
    const tr: Forme[] = [];
    for (const [x, y] of visSoc) {
      tr.push(cyl(x, y, zCap0 - 1, SOC_H + 1, M3_PASS / 2));
      tr.push(cyl(x, y, SOC_H - 1.7, SOC_H + 0.01, M3_PASS / 2, 3.25));
    }
    for (const s of [-1, 1]) {
      const { p, d } = axeVisModule(s);
      const tBas = (p[2] - zCap0) / ct;
      tr.push(cylAxe([p[0] - d[0], p[1] - d[1], p[2] - d[2]], d, tBas + 2, M3_PASS / 2));
      const lam = c.lamageCapot;
      tr.push(cylAxe([p[0] + d[0] * (tBas - lam), p[1] + d[1] * (tBas - lam), p[2] + d[2] * (tBas - lam)], d, lam + 5, 3.25));
    }
    tr.push(rr(PASS_U[0], PASS_U[1], Y0 + PASS_W[0] * ct, Y0 + PASS_W[1] * ct, zCap0 - 1, Z0 + 1, 2));
    // aérations au-dessus de la carte
    for (let i = 0; i < 8; i += 1) {
      const py = 50 - 6.3 * i;
      const [x0, x1, y0, y1] = pi.boite(19.4, 79.4, py - 1.25, py + 1.25);
      tr.push(rr(x0, x1, y0, y1, zCap0 - 1, SOC_H + 1, 1.24));
    }
    return diff(piece, ...tr);
  };

  // ----------------------------------------------------------------- pièces placées
  const voletPlace = (etat: 'ouvert' | 'ferme') => deplacer(volet(), [etat === 'ouvert' ? -K.voletSTrou : -K.voletSPlein, c.vCam, PW.volet0]);
  const boutonPlace = (etat: 'ouvert' | 'ferme') =>
    deplacer(bouton(), [(etat === 'ouvert' ? -K.voletSTrou : -K.voletSPlein) + K.voletSVis, c.vCam + K.vVisVolet, 0]);
  const retenuePlacee = (u: number, v: number, su: number, cv: number) => {
    let f = retenue();
    if (su < 0) f = miroir(f, 'x');
    if (cv < 0) f = miroir(f, 'y');
    return deplacer(f, [u, v, W_RET]);
  };
  const piecesModule = (o: { cache?: 'ouvert' | 'ferme'; decalCam?: number } = {}): Record<string, Forme> => {
    const d: Record<string, Forme> = { Facade: facade(), Dos: dos() };
    if (ch.cache) {
      d.Volet = voletPlace(o.cache ?? 'ouvert');
      d.Bouton_cache = boutonPlace(o.cache ?? 'ouvert');
    }
    if (ch.camera) d.Chariot_camera = deplacer(chariot(), [o.decalCam ?? 0, c.vCam, 0]);
    c.RET.forEach(({ u, v, su, cv }, i) => {
      d[`Retenue_${i + 1}`] = retenuePlacee(u, v, su, cv);
    });
    return d;
  };
  const assemblage = (o: { cache?: 'ouvert' | 'ferme'; decalCam?: number } = {}): Record<string, Forme> => {
    const out: Record<string, Forme> = {};
    for (const [n, f] of Object.entries(piecesModule(o))) out[n] = versMonde(f);
    out.Socle = socle();
    out.Capot = capot();
    return out;
  };

  // ----------------------------------------------------------------- composants (formes prudentes)
  const ecran = (bord: number = ECR.epaisseur_au_bord.valeur): Forme => {
    const u = c.ECR_L / 2;
    const vitre = rr(-u, u, c.vVit0, c.vVit1, PEAU, PEAU + bord);
    const corps = rr(-u + 6, u - 6, c.vVit0 + 6, c.vVit1 - 6, PEAU + bord - 0.01, PEAU + ECR.profondeur_totale.valeur);
    return union(vitre, corps);
  };
  const cameraModule = (decal = 0): Forme => {
    const u0 = -K.objectifB + decal;
    const vc = c.vCam;
    const A = CAM.carte.a;
    const B = CAM.carte.b;
    const T = CAM.carte.epaisseur;
    const pcb = rr(u0, u0 + B, vc - A / 2, vc + A / 2, PW.dosCarte - T, PW.dosCarte);
    const lentille = rr(-5.5 + decal, 5.5 + decal, vc - 5.5, vc + 5.5, PW.objectif, PW.dosCarte - T + 0.01);
    const connecteur = rr(u0 + B - 4.5, u0 + B, vc - 10, vc + 10, PW.dosCarte - 0.01, PW.dosCarte + 2.7);
    const tetes = TROUS_CAMERA.map(([b, a]) => cyl(u0 + b, vc - A / 2 + a, PW.dosCarte - T - 1.4, PW.dosCarte - T + 0.01, 1.9));
    return union(pcb, lentille, connecteur, ...tetes);
  };
  const carte = (): Forme => {
    const z0 = zPcb0;
    const z1 = zPcb1;
    const L = PI5.carte.longueur;
    const box = (px0: number, px1: number, py0: number, py1: number, za: number, zb: number, r = 0) => {
      const [x0, x1, y0, y1] = pi.boite(px0, px1, py0, py1);
      return rr(x0, x1, y0, y1, za, zb, r);
    };
    const pcb = diff(box(0, L, 0, PI5.carte.largeur, z0, z1, PI5.carte.rayon_coins), ...trousPi.map(([x, y]) => cyl(x, y, z0 - 1, z1 + 1, 1.35)));
    const parts: Forme[] = [pcb];
    for (const p of PI5.prises_bord_usb) parts.push(box(L - 18, L + p.depasse, p.py_centre - p.largeur / 2, p.py_centre + p.largeur / 2, z1, z1 + p.hauteur));
    for (const p of PI5.prises_bord_usbc) parts.push(box(p.px_centre - p.largeur / 2, p.px_centre + p.largeur / 2, -0.5, 7.5, z1, z1 + p.hauteur));
    const v = PI5.ventilateur_officiel.enveloppe_prudente;
    parts.push(box(v.px[0], v.px[1], v.py[0], v.py[1], z1, z1 + v.hauteur));
    parts.push(box(7, 58, 50.5, 55.5, z1, z1 + PI5.gpio.hauteur_broches));
    parts.push(box(7, 13, 50.5, 55.5, z1, z1 + PI5.gpio.hauteur_avec_fil_dupont));
    parts.push(box(-PI5.carte_sd.depasse_bord_sd, 12, 15, 30, z0 - 1.2, z0));
    return union(...parts);
  };

  // ----------------------------------------------------------------- pièces à imprimer
  // Repère du module → monde (inclinaison, puis l'arête avant-basse en (Y0, Z0)).
  const M: Matrice = [
    [1, 0, 0, 0],
    [0, st, ct, Y0],
    [0, ct, -st, Z0],
    [0, 0, 0, 1],
  ];
  /** Déplacement éclaté d'une pièce du module : le long de w (vers l'arrière), puis tout le module vers le haut. */
  const eclateModule = (w: number): [number, number, number] => [0, w * ct, 70 - w * st];
  const pieces = (): PieceBoitier[] => {
    const liste: PieceBoitier[] = [
      { nom: 'Facade', titre: 'façade', nombre: 1, sens: 'face avant contre le plateau', forme: facade(), placements: [M], eclate: eclateModule(0) },
      {
        nom: 'Dos',
        titre: 'dos',
        nombre: 1,
        sens: 'fond contre le plateau',
        forme: deplacer(miroir(dos(), 'z'), [0, 0, W_TOT]),
        placements: [produit(M, produit(translation(0, 0, W_TOT), echelle(1, 1, -1)))],
        eclate: eclateModule(70),
      },
      { nom: 'Socle', titre: 'socle', nombre: 1, sens: 'fond contre le plateau', forme: socle(), placements: [translation(0, 0, 0)], eclate: [0, 0, 0] },
      {
        nom: 'Capot',
        titre: 'capot',
        nombre: 1,
        sens: 'plaque contre le plateau, cale vers le haut',
        forme: deplacer(capot(), [0, 0, -zCap0]),
        placements: [translation(0, 0, zCap0)],
        eclate: [0, 0, 35],
      },
    ];
    // Retenues : A tient les places sans miroir ou avec deux miroirs, B celles avec un seul miroir.
    const r = deplacer(miroir(retenue(), 'z'), [0, 0, RETENUE.epaisseur]);
    const versLocale = produit(translation(0, 0, RETENUE.epaisseur), echelle(1, 1, -1));
    const placesA: Matrice[] = [];
    const placesB: Matrice[] = [];
    for (const { u, v, su, cv } of c.RET) {
      const place = produit(M, produit(translation(u, v, W_RET), produit(echelle(su < 0 ? -1 : 1, cv < 0 ? -1 : 1, 1), versLocale)));
      if (su * cv > 0) placesA.push(place);
      else placesB.push(produit(place, echelle(-1, 1, 1)));
    }
    liste.push({ nom: 'Retenue_A', titre: 'retenue A de l’écran', nombre: placesA.length, sens: 'à plat, bosse vers le haut', forme: r, placements: placesA, eclate: eclateModule(35) });
    liste.push({
      nom: 'Retenue_B',
      titre: 'retenue B de l’écran',
      nombre: placesB.length,
      sens: 'à plat, bosse vers le haut (symétrique de A)',
      forme: miroir(r, 'x'),
      placements: placesB,
      eclate: eclateModule(35),
    });
    if (ch.camera) {
      liste.push({
        nom: 'Chariot_camera',
        titre: 'chariot de la caméra',
        nombre: 1,
        sens: 'plaque contre le plateau, plots vers le haut',
        forme: deplacer(miroir(chariot(), 'z'), [0, 0, PW.chariot1]),
        placements: [produit(M, produit(translation(0, c.vCam, PW.chariot1), echelle(1, 1, -1)))],
        eclate: eclateModule(50),
      });
    }
    if (ch.cache) {
      liste.push({
        nom: 'Cache_camera',
        titre: 'cache de la caméra',
        nombre: 1,
        sens: 'à plat',
        forme: volet(),
        placements: [produit(M, translation(-K.voletSTrou, c.vCam, PW.volet0))],
        eclate: eclateModule(15),
      });
      const hTete = K.wBoutTete - K.boutTete[1];
      liste.push({
        nom: 'Bouton_cache',
        titre: 'bouton du cache',
        nombre: 2,
        sens: 'tête contre le plateau (le deuxième sert de rechange)',
        forme: deplacer(bouton(), [0, 0, -hTete]),
        placements: [produit(M, translation(-K.voletSTrou + K.voletSVis, c.vCam + K.vVisVolet, hTete))],
        eclate: eclateModule(-25),
      });
    }
    return liste;
  };

  const scadAssemblage = (): string => {
    const tout = assemblage();
    return `// Boîtier à écran monté — écrit par Jarvis (atelier 3D). Unités : mm.\n${Object.entries(tout)
      .map(([n, f]) => `// ${n}\n${f.scad}`)
      .join('\n')}\n`;
  };

  // Encombrement : socle et module monté.
  const haut = point(0, FH, 0)[2];
  const arriereModule = point(0, FH, W_TOT)[1];
  const encombrement: [number, number, number] = [FW, Math.max(SOC_P, arriereModule), Math.max(SOC_H, haut)];

  return {
    choix: ch,
    c,
    facade,
    dos,
    socle,
    capot,
    assemblage,
    piecesModule,
    ecran,
    cameraModule,
    carte,
    voletPlace,
    versMonde,
    point,
    zBasModule,
    axeVisModule,
    prises,
    pieces,
    encombrement,
    scadAssemblage,
  };
}

/** Données internes utiles au banc (position de la carte, vis du socle). */
export function carteDuBoitier(b: BoitierEcran): { rect: [number, number, number, number]; trous: [number, number][] } {
  const pi = placementCarte(b.c, b.choix.ports);
  const t = PI5.trous;
  const trous = [t.depuis_bord_carte_sd, t.depuis_bord_carte_sd + t.entraxe[0]].flatMap((px) => [t.depuis_bords_longs, t.depuis_bords_longs + t.entraxe[1]].map((py) => pi.xy(px, py)));
  return { rect: pi.rect, trous };
}

/** Repère de la carte → monde, pour le banc (GPIO, ventilateur). */
export function boiteCarte(b: BoitierEcran, px0: number, px1: number, py0: number, py1: number): [number, number, number, number] {
  return placementCarte(b.c, b.choix.ports).boite(px0, px1, py0, py1);
}

/** Les constantes de dessin dont le banc a besoin. */
export const DESSIN_BOITIER_ECRAN = {
  W_JOINT, W_TOT, DOS_EP, PEAU, REBORD, PASS_U, PASS_W, U_BOS_BAS, W_BOS_BAS, INS_P, INS_D, CAP_EP, SOC_P, Y0, PAROI,
  PLOT_PI, JEU_PORT, JEU_PI_RAS, CREUX_PAROI, AIR_VENTILATEUR, V_BOS_CAM, PISTE,
} as const;
