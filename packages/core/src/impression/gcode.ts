/**
 * Lecture d'un fichier G-code (OrcaSlicer, Klipper) avant l'impression. Pur, sans modèle.
 *
 * On suit la buse ligne par ligne et on note, couche par couche et objet par objet, les cases
 * d'une grille de 1 mm où de la matière est déposée. On en tire :
 * - l'emprise au sol de chaque objet (première couche) et sa hauteur ;
 * - les « îlots dans le vide » : de la matière posée sur rien (ni le plateau, ni la couche
 *   d'en dessous), donc imprimée dans l'air ;
 * - la matière déposée hors du volume de l'imprimante.
 *
 * Objets : lignes `EXCLUDE_OBJECT_DEFINE NAME=… CENTER=… POLYGON=[[x,y],…]` et blocs
 * `EXCLUDE_OBJECT_START NAME=…` / `EXCLUDE_OBJECT_END` (OrcaSlicer, option « Exclure des
 * objets » / « Label objects », et `[exclude_object]` dans printer.cfg). Sans eux, toute la
 * matière appartient à un seul objet « impression ».
 * Commandes suivies : G0, G1, G2, G3 (arcs), G90, G91, G92, M82, M83.
 */
import type { Point2 } from './camera3d.js';

export interface IlotVide {
  objet: string;
  /** Hauteur de la couche (mm). */
  z: number;
  /** Surface (mm²) et centre de l'îlot. */
  aire: number;
  centre: Point2;
}

export interface ObjetGcode {
  nom: string;
  /** Polygone déclaré par le trancheur, s'il existe. */
  polygone: Point2[] | null;
  /** Emprise de la première couche (mm) ; `null` si l'objet ne touche jamais le plateau. */
  emprise: { minX: number; maxX: number; minY: number; maxY: number } | null;
  /** Surface posée sur le plateau (mm², à 1 mm près). */
  aireSol: number;
  /** Cases de la première couche (x, y au mm), pour comparer avec la feuille. */
  casesSol: Point2[];
  /** Hauteur de la première matière et hauteur finale (mm). */
  zDebut: number;
  zFin: number;
  /** Étendue de toute la matière déposée (mm). */
  etendue: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface AnalyseGcode {
  objets: ObjetGcode[];
  ilots: IlotVide[];
  /** Hauteur de la première couche (mm). */
  premiereCouche: number;
  /** Nombre de couches vues. */
  couches: number;
  /** Matière déposée hors du volume (premiers points trouvés). */
  horsVolume: { objet: string; x: number; y: number; z: number }[];
  /** Lignes lues. */
  lignes: number;
}

export interface VolumeImprimante {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxZ: number;
}

/** Ender 3 S1 Plus : 300 × 300 × 300 mm. */
export const VOLUME_ENDER3_S1_PLUS: VolumeImprimante = { minX: 0, maxX: 300, minY: 0, maxY: 300, maxZ: 300 };

const SANS_OBJET = 'impression';
const CASE = 1;
const ORIGINE = -50;
const COTE = 450;
/** Hauteur de première couche au-delà de laquelle la matière ne touche pas le plateau (mm). */
export const PREMIERE_COUCHE_MAX = 0.6;
/** Îlot plus petit que ça (mm²) : ignoré (arrondis de la grille). */
export const ILOT_MIN_MM2 = 3;

const MOTS = new Map<string, RegExp>();

function mot(ligne: string, lettre: string): number | undefined {
  let re = MOTS.get(lettre);
  if (!re) {
    re = new RegExp(`(?:^|\\s)${lettre}(-?\\d*\\.?\\d+)`, 'i');
    MOTS.set(lettre, re);
  }
  const m = re.exec(ligne);
  return m ? Number(m[1]) : undefined;
}

function nomObjet(ligne: string): string | null {
  const m = /NAME=("?)([^\s"]+)\1/i.exec(ligne);
  return m ? m[2]! : null;
}

function lirePolygone(ligne: string): Point2[] | null {
  const m = /POLYGON=(\[\[.*?\]\])/i.exec(ligne);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]!) as unknown;
    if (!Array.isArray(raw)) return null;
    const pts = raw.filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && p.every((v) => typeof v === 'number'));
    return pts.length >= 3 ? pts.map((p) => [p[0], p[1]] as Point2) : null;
  } catch {
    return null;
  }
}

interface Suivi {
  cases: Map<string, Set<number>>;
}

function indexCase(x: number, y: number): number {
  const i = Math.floor((x - ORIGINE) / CASE);
  const j = Math.floor((y - ORIGINE) / CASE);
  if (i < 0 || j < 0 || i >= COTE || j >= COTE) return -1;
  return j * COTE + i;
}

function caseVersPoint(c: number): Point2 {
  return [ORIGINE + (c % COTE) * CASE + CASE / 2, ORIGINE + Math.floor(c / COTE) * CASE + CASE / 2];
}

/** Lit un G-code entier (texte). */
export function analyserGcode(texte: string, volume: VolumeImprimante = VOLUME_ENDER3_S1_PLUS): AnalyseGcode {
  const polygones = new Map<string, Point2[] | null>();
  const ordre: string[] = [];
  const info = new Map<string, Omit<ObjetGcode, 'nom' | 'polygone'> & { sol: Set<number> }>();
  const ilots: IlotVide[] = [];
  const horsVolume: AnalyseGcode['horsVolume'] = [];

  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let relatifXYZ = false;
  let relatifE = false;
  let objet = SANS_OBJET;
  let premiere: number | null = null;
  let coucheZ: number | null = null;
  let couches = 0;
  let avant: Set<number> = new Set();
  let courante: Suivi = { cases: new Map() };
  let lignes = 0;

  const noter = (nom: string) => {
    if (!info.has(nom)) {
      if (!ordre.includes(nom)) ordre.push(nom);
      info.set(nom, {
        emprise: null,
        aireSol: 0,
        casesSol: [],
        zDebut: Infinity,
        zFin: 0,
        etendue: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
        sol: new Set(),
      });
    }
    return info.get(nom)!;
  };

  const finirCouche = () => {
    if (coucheZ === null) return;
    const toutes = new Set<number>();
    for (const s of courante.cases.values()) for (const c of s) toutes.add(c);
    // Une première couche plus haute que 0,6 mm ne touche pas le plateau : tout commence dans le vide.
    const surPlateau = premiere !== null && premiere <= PREMIERE_COUCHE_MAX && coucheZ <= premiere + 0.05;
    for (const [nom, cases] of courante.cases) {
      if (surPlateau) {
        const o = noter(nom);
        for (const c of cases) o.sol.add(c);
        continue;
      }
      // Îlots : composantes connexes sans aucune case de la couche d'en dessous à moins d'1 mm.
      const vues = new Set<number>();
      for (const depart of cases) {
        if (vues.has(depart)) continue;
        const pile = [depart];
        vues.add(depart);
        const comp: number[] = [];
        let porte = false;
        while (pile.length) {
          const c = pile.pop()!;
          comp.push(c);
          const i = c % COTE;
          const j = Math.floor(c / COTE);
          for (let dj = -1; dj <= 1 && !porte; dj++)
            for (let di = -1; di <= 1; di++) if (avant.has((j + dj) * COTE + i + di)) porte = true;
          for (const v of [c - 1, c + 1, c - COTE, c + COTE]) {
            if (cases.has(v) && !vues.has(v)) {
              vues.add(v);
              pile.push(v);
            }
          }
        }
        // Un bout de la même couche peut tenir par un autre objet (supports partagés) : couche entière.
        if (!porte) {
          const aire = comp.length * CASE * CASE;
          if (aire >= ILOT_MIN_MM2) {
            const pts = comp.map(caseVersPoint);
            ilots.push({
              objet: nom,
              z: coucheZ,
              aire,
              centre: [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length],
            });
          }
        }
      }
    }
    avant = toutes;
    courante = { cases: new Map() };
  };

  const deposer = (x0: number, y0: number, x1: number, y1: number, zz: number) => {
    if (premiere === null) premiere = zz;
    if (coucheZ === null || zz > coucheZ + 0.04) {
      finirCouche();
      coucheZ = zz;
      couches++;
    } else if (zz < coucheZ - 0.04) {
      // Impression objet par objet : la buse redescend pour l'objet suivant.
      finirCouche();
      if (premiere !== null && zz <= premiere + 0.05) avant = new Set();
      coucheZ = zz;
      couches++;
    }
    const o = noter(objet);
    o.zDebut = Math.min(o.zDebut, zz);
    o.zFin = Math.max(o.zFin, zz);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const pas = Math.max(1, Math.ceil(len / (CASE / 2)));
    let set = courante.cases.get(objet);
    if (!set) {
      set = new Set();
      courante.cases.set(objet, set);
    }
    for (let k = 0; k <= pas; k++) {
      const px = x0 + ((x1 - x0) * k) / pas;
      const py = y0 + ((y1 - y0) * k) / pas;
      o.etendue.minX = Math.min(o.etendue.minX, px);
      o.etendue.maxX = Math.max(o.etendue.maxX, px);
      o.etendue.minY = Math.min(o.etendue.minY, py);
      o.etendue.maxY = Math.max(o.etendue.maxY, py);
      if ((px < volume.minX - 0.01 || px > volume.maxX + 0.01 || py < volume.minY - 0.01 || py > volume.maxY + 0.01 || zz > volume.maxZ) && horsVolume.length < 20) {
        if (!horsVolume.some((h) => h.objet === objet)) horsVolume.push({ objet, x: px, y: py, z: zz });
      }
      const c = indexCase(px, py);
      if (c >= 0) set.add(c);
    }
  };

  for (const brute of texte.split(/\r?\n/)) {
    lignes++;
    const ligne = brute.split(';')[0]!.trim();
    if (!ligne) continue;
    const cmd = ligne.split(/\s+/)[0]!.toUpperCase();
    if (cmd === 'EXCLUDE_OBJECT_DEFINE') {
      const nom = nomObjet(ligne);
      if (nom) {
        polygones.set(nom, lirePolygone(ligne));
        if (!ordre.includes(nom)) ordre.push(nom);
      }
      continue;
    }
    if (cmd === 'EXCLUDE_OBJECT_START') {
      objet = nomObjet(ligne) ?? SANS_OBJET;
      continue;
    }
    if (cmd === 'EXCLUDE_OBJECT_END') {
      objet = SANS_OBJET;
      continue;
    }
    if (cmd === 'G90') relatifXYZ = false;
    else if (cmd === 'G91') relatifXYZ = true;
    else if (cmd === 'M82') relatifE = false;
    else if (cmd === 'M83') relatifE = true;
    else if (cmd === 'G92') {
      const ne = mot(ligne, 'E');
      if (ne !== undefined) e = ne;
      const nx = mot(ligne, 'X');
      const ny = mot(ligne, 'Y');
      const nz = mot(ligne, 'Z');
      if (nx !== undefined) x = nx;
      if (ny !== undefined) y = ny;
      if (nz !== undefined) z = nz;
    } else if (cmd === 'G0' || cmd === 'G1' || cmd === 'G2' || cmd === 'G3') {
      const mx = mot(ligne, 'X');
      const my = mot(ligne, 'Y');
      const mz = mot(ligne, 'Z');
      const me = mot(ligne, 'E');
      const nx = mx === undefined ? x : relatifXYZ ? x + mx : mx;
      const ny = my === undefined ? y : relatifXYZ ? y + my : my;
      const nz = mz === undefined ? z : relatifXYZ ? z + mz : mz;
      let extrude = false;
      if (me !== undefined) {
        const de = relatifE ? me : me - e;
        e = relatifE ? e + me : me;
        extrude = de > 1e-5 && cmd !== 'G0';
      }
      if (extrude) {
        if (cmd === 'G1') deposer(x, y, nx, ny, nz);
        else {
          const i = mot(ligne, 'I') ?? 0;
          const j = mot(ligne, 'J') ?? 0;
          const cx = x + i;
          const cy = y + j;
          const r = Math.hypot(i, j);
          const a0 = Math.atan2(y - cy, x - cx);
          let a1 = Math.atan2(ny - cy, nx - cx);
          if (cmd === 'G2' && a1 >= a0) a1 -= 2 * Math.PI;
          if (cmd === 'G3' && a1 <= a0) a1 += 2 * Math.PI;
          const pas = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / CASE));
          let px = x;
          let py = y;
          for (let k = 1; k <= pas; k++) {
            const a = a0 + ((a1 - a0) * k) / pas;
            const qx = k === pas ? nx : cx + r * Math.cos(a);
            const qy = k === pas ? ny : cy + r * Math.sin(a);
            deposer(px, py, qx, qy, nz);
            px = qx;
            py = qy;
          }
        }
      }
      x = nx;
      y = ny;
      z = nz;
    }
  }
  finirCouche();

  const objets: ObjetGcode[] = [];
  for (const nom of ordre) {
    const o = info.get(nom);
    const polygone = polygones.get(nom) ?? null;
    if (!o) {
      objets.push({ nom, polygone, emprise: null, aireSol: 0, casesSol: [], zDebut: 0, zFin: 0, etendue: { minX: 0, maxX: 0, minY: 0, maxY: 0 } });
      continue;
    }
    const casesSol = [...o.sol].map(caseVersPoint);
    const emprise = casesSol.length
      ? {
          minX: Math.min(...casesSol.map((p) => p[0])) - CASE / 2,
          maxX: Math.max(...casesSol.map((p) => p[0])) + CASE / 2,
          minY: Math.min(...casesSol.map((p) => p[1])) - CASE / 2,
          maxY: Math.max(...casesSol.map((p) => p[1])) + CASE / 2,
        }
      : null;
    objets.push({
      nom,
      polygone,
      emprise,
      aireSol: casesSol.length * CASE * CASE,
      casesSol,
      zDebut: Number.isFinite(o.zDebut) ? o.zDebut : 0,
      zFin: o.zFin,
      etendue: o.etendue,
    });
  }
  return { objets, ilots, premiereCouche: premiere ?? 0, couches, horsVolume, lignes };
}
